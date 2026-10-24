import { digest } from './state-store.mjs';
const ITERATIONS = 600000, MAX_BODY = 380000, MAX_IMAGE = 8 * 1024 * 1024 + 16;
class InputError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
function envelope(value, limit) {
  if (!value || typeof value.iv !== 'string' || !/^[A-Za-z0-9+/]{16}$/.test(value.iv) || typeof value.ciphertext !== 'string' || value.ciphertext.length < 24 || value.ciphertext.length > limit || value.ciphertext.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.ciphertext)) throw new InputError('Conteúdo criptografado inválido.');
  return JSON.stringify({ iv: value.iv, ciphertext: value.ciphertext });
}
async function limitedBytes(request, max) {
  if (!request.body || Number(request.headers.get('content-length')) > max) throw new InputError('Arquivo ou referência grande demais.', 413);
  const reader = request.body.getReader(), chunks = []; let length = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > max) { await reader.cancel(); throw new InputError('Arquivo ou referência grande demais.', 413); } chunks.push(value); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}
async function bodyJSON(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new InputError('Formato inválido.', 415);
  let body; try { body = JSON.parse(new TextDecoder().decode(await limitedBytes(request, MAX_BODY))); } catch (error) { if (error instanceof InputError) throw error; throw new InputError('JSON inválido.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('Dados inválidos.'); return body;
}
async function vault(db, owner) { return db.prepare('SELECT salt, iterations, verifier FROM reference_vaults WHERE owner_id = ?').bind(owner).first(); }
export async function handleReferences(request, db, bucket, owner, fileId = null) {
  if (!owner) return json({ error: 'Entre na sua conta para acessar as referências.' }, 401);
  if (!db) return json({ error: 'Banco indisponível. Tente novamente.' }, 503);
  try {
    const write = request.method !== 'GET';
    const origin = request.headers.get('origin');
    if (write && (request.headers.get('sec-fetch-site') === 'cross-site' || origin && origin !== new URL(request.url).origin)) return json({ error: 'Origem inválida.' }, 403);
    if (fileId !== null) {
      if (!bucket) return json({ error: 'Armazenamento de imagens indisponível.' }, 503);
      if (!/^[a-f0-9]{64}$/.test(fileId)) throw new InputError('Imagem inválida.');
      if (!await vault(db, owner)) return json({ error: 'Configure suas referências primeiro.' }, 403);
      const objectKey = 'references/' + await digest(owner) + '/' + fileId;
      if (request.method === 'GET') {
        const object = await bucket.get(objectKey); if (!object) return json({ error: 'Imagem não encontrada.' }, 404);
        return new Response(object.body, { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'attachment; filename="encrypted-image.bin"' } });
      }
      if (request.method !== 'PUT') return json({ error: 'Método não permitido.' }, 405);
      const data = await limitedBytes(request, MAX_IMAGE);
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), b => b.toString(16).padStart(2, '0')).join('');
      if (data.length < 16 || hash !== fileId) throw new InputError('A imagem não corresponde ao identificador.');
      await bucket.put(objectKey, data, { httpMetadata: { contentType: 'application/octet-stream' } });
      return json({ id: fileId });
    }
    if (request.method === 'GET') {
      const config = await vault(db, owner); if (!config) return json({ exists: false });
      const id = new URL(request.url).searchParams.get('id');
      if (id) {
        const row = await db.prepare('SELECT id, revision, payload FROM reference_items WHERE owner_id = ? AND id = ?').bind(owner, id).first();
        return row ? json({ id: row.id, revision: row.revision, envelope: JSON.parse(row.payload) }) : json({ error: 'Referência não encontrada.' }, 404);
      }
      const { results } = await db.prepare('SELECT id, revision, summary FROM reference_items WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 500').bind(owner).all();
      return json({ exists: true, salt: config.salt, iterations: config.iterations, verifier: JSON.parse(config.verifier), items: results.map(row => ({ id: row.id, revision: row.revision, envelope: JSON.parse(row.summary) })) });
    }
    if (!['POST', 'PUT'].includes(request.method)) return json({ error: 'Método não permitido.' }, 405);
    const input = await bodyJSON(request);
    if (request.method === 'POST') {
      if (typeof input.salt !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(input.salt) || input.iterations !== ITERATIONS) throw new InputError('Configuração de proteção inválida.');
      const verifier = envelope(input.verifier, 2000);
      await db.prepare('INSERT OR IGNORE INTO reference_vaults (owner_id, salt, iterations, verifier, created_at) VALUES (?, ?, ?, ?, ?)').bind(owner, input.salt, ITERATIONS, verifier, new Date().toISOString()).run();
      const saved = await vault(db, owner);
      if (saved.salt !== input.salt || saved.verifier !== verifier) return json({ error: 'As referências já foram configuradas. Reabra a aba para desbloquear.' }, 409);
      return json({ created: true });
    }
    if (!await vault(db, owner)) return json({ error: 'Configure suas referências primeiro.' }, 403);
    const { id, baseRevision, requestId } = input;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(id) || typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(requestId) || !Number.isSafeInteger(baseRevision) || baseRevision < 0) throw new InputError('Dados de gravação inválidos.');
    const summary = envelope(input.summary, 4000), payload = envelope(input.envelope, 340000);
    const previous = await db.prepare('SELECT revision, write_id, summary, payload FROM reference_items WHERE owner_id = ? AND id = ?').bind(owner, id).first();
    if (previous?.write_id === requestId) {
      if (previous.payload !== payload || previous.summary !== summary) return json({ error: 'Este envio corresponde a outro conteúdo.' }, 409);
      return json({ id, revision: previous.revision, requestId });
    }
    const stamp = new Date().toISOString(); let result;
    if (baseRevision === 0) {
      result = await db.prepare('INSERT OR IGNORE INTO reference_items (owner_id, id, revision, summary, payload, write_id, updated_at) SELECT ?, ?, 1, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM reference_items WHERE owner_id = ?) < 500 RETURNING revision').bind(owner, id, summary, payload, requestId, stamp, owner).first();
    } else result = await db.prepare('UPDATE reference_items SET revision = revision + 1, summary = ?, payload = ?, write_id = ?, updated_at = ? WHERE owner_id = ? AND id = ? AND revision = ? RETURNING revision').bind(summary, payload, requestId, stamp, owner, id, baseRevision).first();
    if (!result) {
      const raced = await db.prepare('SELECT revision, write_id, payload, summary FROM reference_items WHERE owner_id = ? AND id = ?').bind(owner, id).first();
      if (raced?.write_id === requestId && raced.payload === payload && raced.summary === summary) return json({ id, revision: raced.revision, requestId });
      return json({ error: 'Esta referência mudou em outra aba, ou o limite de 500 referências foi atingido. Seu texto foi preservado.' }, 409);
    }
    return json({ id, revision: result.revision, requestId });
  } catch (error) { return json({ error: error instanceof InputError ? error.message : 'Não foi possível acessar as referências. Tente novamente.' }, error instanceof InputError ? error.status : 503); }
}
