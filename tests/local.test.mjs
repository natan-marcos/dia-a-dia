import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:http';
import { startLocal } from '../server/local.mjs';
import '../public/reference-crypto.js';
const V = globalThis.ReferenceCrypto;

test('Aplicativo local: SQLite, imagens e referências persistem após reiniciar sem autenticação ou nuvem', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'daily-local-test-'));
  let app = await startLocal({ dataDir, port: 0 });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  async function api(path, method = 'GET', body) {
    const response = await fetch(app.origin + path, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal(response.status, 200, await response.clone().text()); return response.json();
  }
  const home = await fetch(app.origin);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-security-policy'), /connect-src 'self'/);
  const html = await home.text();
  assert.doesNotMatch(html, /chatgpt|signin|openai/i);
  assert.match(html, /Funciona sem internet/);
  const state = { schemaVersion: 1, days: { '2026-10-24': { text: 'Nota local ✓', updatedAt: new Date().toISOString() } }, tasks: [], preferences: { theme: 'dark' } };
  const initial = await api('/api/state'); assert.equal(initial.revision, 0);
  await api('/api/state', 'PUT', { state, baseRevision: 0, requestId: crypto.randomUUID() });
  const salt = V.newSalt(), key = await V.derive('senha local de teste', salt);
  await api('/api/references', 'POST', { salt, iterations: V.ITERATIONS, verifier: await V.seal(key, { marker: 'daily-references-v1' }, 'verifier') });
  const plain = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const encrypted = await V.sealBytes(key, plain, 'image'), imageId = await V.hash(encrypted.data);
  const uploaded = await fetch(app.origin + '/api/reference-files/' + imageId, { method: 'PUT', body: encrypted.data });
  assert.equal(uploaded.status, 200);
  const id = crypto.randomUUID(), item = { title: 'Referência local', kind: 'image', content: 'Olá', image: { id: imageId, iv: encrypted.iv, mime: 'image/png' } };
  await api('/api/references', 'PUT', { id, baseRevision: 0, requestId: crypto.randomUUID(), summary: await V.seal(key, { title: item.title, kind: item.kind }, 'summary:' + id), envelope: await V.seal(key, item, 'item:' + id) });
  await app.close(); app = await startLocal({ dataDir, port: 0 });
  assert.deepEqual((await api('/api/state')).state, state);
  assert.deepEqual(await V.open(key, (await api('/api/references?id=' + id)).envelope, 'item:' + id), item);
  const stored = new Uint8Array(await (await fetch(app.origin + '/api/reference-files/' + imageId)).arrayBuffer());
  assert.deepEqual(await V.openBytes(key, stored, encrypted.iv, 'image'), plain);
  assert.match((await readFile(join(dataDir, 'dia-a-dia.sqlite'))).toString('utf8', 0, 15), /SQLite format 3/);
  assert.ok((await readdir(dataDir)).includes('imagens'));
});

test('Servidor local rejeita sites externos, Host adulterado e acesso a arquivos internos', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'daily-local-guard-'));
  const app = await startLocal({ dataDir, port: 0 });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  assert.equal((await fetch(app.origin + '/api/state', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(app.origin + '/api/state', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  const invalidHostStatus = await new Promise((resolve, reject) => { get(app.origin + '/api/state', { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject); });
  assert.equal(invalidHostStatus, 403);
  for (const path of ['/server/local.mjs', '/dia-a-dia.sqlite', '/package.json', '/signin-with-chatgpt', '/api/reference-files/../../../controle-local.txt']) assert.equal((await fetch(app.origin + path)).status, 404);
  assert.equal((await fetch(app.origin + '/api/local/stop', { method: 'POST' })).status, 403);
  assert.equal((await fetch(app.origin + '/api/local/health')).status, 200);
});
