import '../public/core.js';
const C = globalThis.DailyCore;
export const MAX_BYTES = 12 * 1024 * 1024;
export class StoreError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export async function digest(text) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
}
export function splitPayload(text) {
  const chunks = []; let start = 0;
  while (start < text.length) {
    let end = Math.min(start + 180000, text.length);
    // Never split a Unicode surrogate pair across SQLite rows.
    if (end < text.length && text.charCodeAt(end - 1) >= 0xD800 && text.charCodeAt(end - 1) <= 0xDBFF) end--;
    chunks.push(text.slice(start, end)); start = end;
  }
  return chunks;
}
function encode(state) {
  const clean = C.validate(state), payload = JSON.stringify(clean);
  if (new TextEncoder().encode(payload).byteLength > MAX_BYTES) throw new StoreError('O conjunto de anotações excede 12 MB. Baixe um backup para preservar o conteúdo.', 413);
  return { state: clean, payload };
}
export async function readState(db, owner) {
  const { results } = await db.prepare('SELECT d.revision, c.position, c.payload FROM daily_documents d LEFT JOIN daily_chunks c ON c.owner_id = d.owner_id WHERE d.owner_id = ? ORDER BY c.position').bind(owner).all();
  if (!results.length) return { revision: 0, state: C.empty() };
  const payload = results.map(row => row.payload || '').join('');
  return { revision: results[0].revision, state: payload ? C.validate(JSON.parse(payload)) : C.empty() };
}
async function receipt(db, owner, requestId) {
  return db.prepare('SELECT revision, fingerprint FROM daily_writes WHERE owner_id = ? AND request_id = ?').bind(owner, requestId).first();
}
export async function writeState(db, owner, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new StoreError('Requisição de salvamento inválida.');
  const { baseRevision, requestId } = input;
  if (!Number.isSafeInteger(baseRevision) || baseRevision < 0 || typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,120}$/.test(requestId)) throw new StoreError('Requisição de salvamento inválida.');
  const { payload } = encode(input.state), fingerprint = await digest(payload);
  const prior = await receipt(db, owner, requestId);
  if (prior) {
    if (prior.fingerprint !== fingerprint) throw new StoreError('Esse envio já foi usado para outro conteúdo.', 409);
    return { revision: prior.revision, requestId };
  }
  const token = crypto.randomUUID(), now = new Date().toISOString();
  const statements = [
    db.prepare('INSERT OR IGNORE INTO daily_documents (owner_id, revision, write_id, updated_at) VALUES (?, 0, ?, ?)').bind(owner, '', now),
    db.prepare('UPDATE daily_documents SET revision = revision + 1, write_id = ?, updated_at = ? WHERE owner_id = ? AND revision = ?').bind(token, now, owner, baseRevision),
    db.prepare('DELETE FROM daily_chunks WHERE owner_id = ? AND EXISTS (SELECT 1 FROM daily_documents WHERE owner_id = ? AND write_id = ?)').bind(owner, owner, token),
  ];
  splitPayload(payload).forEach((chunk, index) => statements.push(db.prepare('INSERT INTO daily_chunks (owner_id, position, payload) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM daily_documents WHERE owner_id = ? AND write_id = ?)').bind(owner, index, chunk, owner, token)));
  statements.push(db.prepare('INSERT INTO daily_writes (owner_id, request_id, fingerprint, revision) SELECT ?, ?, ?, revision FROM daily_documents WHERE owner_id = ? AND write_id = ?').bind(owner, requestId, fingerprint, owner, token));
  statements.push(db.prepare('SELECT revision, fingerprint FROM daily_writes WHERE owner_id = ? AND request_id = ?').bind(owner, requestId));
  // D1 batch is atomic. A fresh internal token gates every mutation on the CAS.
  const results = await db.batch(statements), accepted = results.at(-1)?.results?.[0];
  if (!accepted || accepted.fingerprint !== fingerprint) throw new StoreError('Os dados foram alterados em outra aba ou dispositivo. Seu rascunho foi preservado.', 409);
  return { revision: accepted.revision, requestId };
}
export async function migrateState(db, owner, legacyState) {
  const { state, payload } = encode(legacyState);
  const requestId = 'migration_' + await digest(payload);
  if (await receipt(db, owner, requestId)) return { ...await readState(db, owner), migrated: true };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await receipt(db, owner, requestId)) return { ...await readState(db, owner), migrated: true };
    const latest = await readState(db, owner), merged = C.merge(latest.state, state).state;
    try { await writeState(db, owner, { baseRevision: latest.revision, requestId, state: merged }); return { ...await readState(db, owner), migrated: true }; }
    catch (error) { if (error.status !== 409) throw error; }
  }
  throw new StoreError('Outra aba está alterando os dados. Tente transferir novamente.', 409);
}
async function readBody(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new StoreError('Envie JSON.', 415);
  if (Number(request.headers.get('content-length')) > MAX_BYTES + 1024) throw new StoreError('O envio excede 12 MB.', 413);
  if (!request.body) throw new StoreError('Envio vazio.');
  const reader = request.body.getReader(), chunks = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_BYTES + 1024) { await reader.cancel(); throw new StoreError('O envio excede 12 MB.', 413); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new StoreError('JSON inválido.'); }
}
export async function handleState(request, db, owner) {
  const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff' } });
  if (!owner) return json({ error: 'Entre na sua conta para acessar suas anotações.' }, 401);
  if (!db) return json({ error: 'O banco está temporariamente indisponível. Tente novamente.' }, 503);
  try {
    if (request.method === 'GET') return json(await readState(db, owner));
    if (request.method !== 'PUT' && request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
    const origin = request.headers.get('origin');
    if (request.headers.get('sec-fetch-site') === 'cross-site' || origin && origin !== new URL(request.url).origin) return json({ error: 'Origem inválida.' }, 403);
    const body = await readBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new StoreError('Envie um objeto JSON válido.');
    if (request.method === 'POST') return json(await migrateState(db, owner, body.state));
    return json(await writeState(db, owner, body));
  } catch (error) {
    if (error instanceof StoreError) return json({ error: error.message }, error.status);
    if (error.message?.includes('backup')) return json({ error: error.message }, 422);
    console.error('SQLite state operation failed', error.name);
    return json({ error: 'Não foi possível confirmar o salvamento no banco. Tente novamente.' }, 503);
  }
}
