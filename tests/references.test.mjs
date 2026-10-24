import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import '../public/reference-crypto.js';
import { handleReferences } from '../server/references-store.mjs';
const V = globalThis.ReferenceCrypto;
const password = 'senha de teste fictícia';
const salt = V.newSalt(), key = await V.derive(password, salt);
const setup = { salt, iterations: V.ITERATIONS, verifier: await V.seal(key, { marker: 'daily-references-v1' }, 'verifier') };
const item = { title: 'Web.config de exemplo', kind: 'config', content: '<configuration>ação 🔐</configuration>', password: 'segredo fictício', archived: false };
function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of ['0000_sweet_nuke.sql', '0001_pink_speedball.sql']) sqlite.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  t.after(() => sqlite.close());
  const statement = (sql, values = []) => ({
    bind: (...params) => statement(sql, params),
    async first() { return sqlite.prepare(sql).get(...values) || null; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    async run() { return sqlite.prepare(sql).run(...values); }
  });
  return { prepare: sql => statement(sql), sqlite };
}
function request(method, data, suffix = '', headers = {}) {
  return new Request('https://daily.example/api/references' + suffix, { method, headers: { 'content-type': 'application/json', ...headers }, ...(data ? { body: JSON.stringify(data) } : {}) });
}
async function write(data = item, id = 'reference_01', baseRevision = 0) {
  return { id, baseRevision, requestId: crypto.randomUUID(), summary: await V.seal(key, { title: data.title, kind: data.kind, archived: data.archived }, 'summary:' + id), envelope: await V.seal(key, data, 'item:' + id) };
}
test('Criptografia preserva Unicode e rejeita senha, contexto e conteúdo alterados', async () => {
  const sealed = await V.seal(key, item, 'item:reference_01');
  assert.deepEqual(await V.open(key, sealed, 'item:reference_01'), item);
  assert.equal(JSON.stringify(sealed).includes(item.password), false);
  assert.equal(key.extractable, false);
  await assert.rejects(V.open(await V.derive('senha errada', salt), sealed, 'item:reference_01'));
  await assert.rejects(V.open(key, sealed, 'item:reference_02'));
  const altered = V.bytes(sealed.ciphertext); altered[0] ^= 1;
  await assert.rejects(V.open(key, { ...sealed, ciphertext: V.base64(altered) }, 'item:reference_01'));
  assert.notEqual((await V.seal(key, item, 'item:reference_01')).iv, sealed.iv);
});
test('SQLite: configurar, salvar, reabrir e isolar usuários sem texto aberto', async t => {
  const db = database(t), call = (method, body, owner = 'alice', suffix = '') => handleReferences(request(method, body, suffix), db, null, owner);
  assert.equal((await call('GET', null, null)).status, 401);
  assert.deepEqual(await (await call('GET')).json(), { exists: false });
  assert.equal((await call('POST', setup)).status, 200);
  assert.equal((await call('POST', setup)).status, 200);
  assert.equal((await call('POST', { ...setup, salt: V.newSalt() })).status, 409);
  const body = await write();
  assert.equal((await call('PUT', body)).status, 200);
  const stored = await (await call('GET', null, 'alice', '?id=' + body.id)).json();
  assert.equal(stored.revision, 1);
  assert.deepEqual(await V.open(key, stored.envelope, 'item:' + body.id), item);
  const listing = await (await call('GET')).json();
  assert.equal(listing.items.length, 1);
  assert.equal(JSON.stringify(listing).includes(item.title), false);
  assert.equal(JSON.stringify(db.sqlite.prepare('SELECT * FROM reference_items').all()).includes(item.password), false);
  assert.equal((await call('POST', setup, 'bob')).status, 200);
  assert.equal((await call('GET', null, 'bob', '?id=' + body.id)).status, 404);
  assert.equal((await (await call('GET', null, 'bob')).json()).items.length, 0);
});
test('Reenvio idempotente e conflito preservam a última gravação', async t => {
  const db = database(t), call = (method, data) => handleReferences(request(method, data), db, null, 'alice');
  await call('POST', setup);
  const first = await write();
  assert.equal((await (await call('PUT', first)).json()).revision, 1);
  assert.equal((await (await call('PUT', first)).json()).revision, 1);
  const second = await write({ ...item, content: 'Atualizado' }, first.id, 1);
  assert.equal((await (await call('PUT', second)).json()).revision, 2);
  assert.equal((await call('PUT', await write(item, first.id, 1))).status, 409);
  assert.equal((await call('PUT', { ...second, envelope: first.envelope })).status, 409);
  const competing = await Promise.all([call('PUT', await write(item, first.id, 2)), call('PUT', await write(item, first.id, 2))]);
  assert.deepEqual(competing.map(r => r.status).sort(), [200, 409]);
  assert.equal(db.sqlite.prepare('SELECT revision FROM reference_items').get().revision, 3);
});
test('Rejeita origem cruzada, envelopes inválidos e payload excessivo', async t => {
  const db = database(t);
  assert.equal((await handleReferences(request('POST', setup, '', { origin: 'https://other.example' }), db, null, 'alice')).status, 403);
  assert.equal((await handleReferences(request('POST', { ...setup, iterations: 1 }), db, null, 'alice')).status, 400);
  await handleReferences(request('POST', setup), db, null, 'alice');
  assert.equal((await handleReferences(request('PUT', { ...await write(), envelope: { iv: 'x', ciphertext: 'x' } }), db, null, 'alice')).status, 400);
  assert.equal((await handleReferences(request('PUT', { text: 'x'.repeat(390000) }), db, null, 'alice')).status, 413);
  assert.throws(() => V.validateItem({ ...item, content: 'x'.repeat(250001) }));
});
test('Imagens: R2 recebe apenas bytes cifrados, verifica integridade e isola donos', async t => {
  const db = database(t), objects = new Map();
  const bucket = { async put(id, data) { objects.set(id, data.slice()); }, async get(id) { return objects.has(id) ? { body: objects.get(id).slice() } : null; } };
  for (const owner of ['alice', 'bob']) await handleReferences(request('POST', setup), db, bucket, owner);
  const original = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const encrypted = await V.sealBytes(key, original, 'image'), id = await V.hash(encrypted.data);
  const upload = data => new Request('https://daily.example/api/reference-files/' + id, { method: 'PUT', body: data });
  assert.equal((await handleReferences(upload(encrypted.data), db, bucket, 'alice', id)).status, 200);
  assert.notDeepEqual([...objects.values()][0], original);
  const get = () => new Request('https://daily.example/api/reference-files/' + id);
  const loaded = new Uint8Array(await (await handleReferences(get(), db, bucket, 'alice', id)).arrayBuffer());
  assert.deepEqual(await V.openBytes(key, loaded, encrypted.iv, 'image'), original);
  assert.equal((await handleReferences(get(), db, bucket, 'bob', id)).status, 404);
  assert.equal((await handleReferences(get(), db, bucket, null, id)).status, 401);
  const altered = encrypted.data.slice(); altered[0] ^= 1;
  assert.equal((await handleReferences(upload(altered), db, bucket, 'alice', id)).status, 400);
  assert.deepEqual([...objects.values()][0], encrypted.data);
});
