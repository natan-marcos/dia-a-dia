import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../public/reference-crypto.js';
import { startLocal } from '../server/local.mjs';
const V = globalThis.ReferenceCrypto, Images = globalThis.ReferenceImages;
const png = new Uint8Array(await readFile(new URL('../public/app-icon.png', import.meta.url)));
const salt = V.newSalt(), key = await V.derive('teste123', salt);
const decodeImage = async () => {};

test('Várias imagens: adicionar, salvar, reiniciar, reabrir e remover preserva os outros anexos', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'daily-images-test-'));
  let app = await startLocal({ dataDir, port: 0 }), writes = 0;
  const collections = [];
  t.after(async () => { collections.forEach(collection => collection.close()); await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const fetcher = async (path, options) => {
    const response = await fetch(app.origin + path, options);
    assert.equal(response.status, 200, await response.clone().text());
    if (options?.method === 'PUT' && path.startsWith('/api/reference-files/')) writes++;
    return response;
  };
  const json = async (method, body, suffix = '') => (await fetcher('/api/references' + suffix, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })).json();
  await json('POST', { salt, iterations: V.ITERATIONS, verifier: await V.seal(key, { marker: 'daily-references-v1' }, 'verifier') });
  const id = crypto.randomUUID();
  async function save(collection, revision) {
    await collection.uploadAll();
    const item = V.validateItem({ title: 'Telas do sistema', kind: 'config', content: '<configuration/>', images: collection.metadata() });
    const result = await json('PUT', { id, baseRevision: revision, requestId: crypto.randomUUID(), summary: await V.seal(key, { title: item.title, kind: item.kind }, 'summary:' + id), envelope: await V.seal(key, item, 'item:' + id) });
    return result.revision;
  }
  function collection() { const result = Images.create({ key, fetcher, decodeImage }); collections.push(result); return result; }
  const first = collection();
  for (const name of ['tela-1.png', 'tela-2.png', 'tela-3.png']) await first.attach(new File([png], name, { type: 'image/png' }));
  assert.equal(new Set(first.metadata().map(image => image.id)).size, 3);
  assert.equal(await save(first, 0), 1);
  await first.uploadAll(); assert.equal(writes, 3, 'Reenviar não duplica uploads confirmados.');
  const oldUrl = await first.load(first.entries[0]);
  assert.deepEqual(new Uint8Array(await (await fetch(oldUrl)).arrayBuffer()), png);
  first.close(); await assert.rejects(fetch(oldUrl));
  await app.close(); app = await startLocal({ dataDir, port: 0 });
  const stored = await json('GET', null, '?id=' + id), restoredItem = await V.open(key, stored.envelope, 'item:' + id);
  assert.equal(restoredItem.kind, 'config'); assert.equal(restoredItem.content, '<configuration/>');
  assert.equal(restoredItem.images.length, 3);
  const restored = collection(); restored.restore(V.imagesOf(V.validateItem(restoredItem)));
  for (const entry of restored.entries) assert.deepEqual(new Uint8Array(await (await fetch(await restored.load(entry))).arrayBuffer()), png);
  const removed = restored.entries[1], removedUrl = removed.url;
  restored.remove(removed); await assert.rejects(fetch(removedUrl));
  assert.equal(await save(restored, stored.revision), 2);
  const saved = await V.open(key, (await json('GET', null, '?id=' + id)).envelope, 'item:' + id);
  assert.deepEqual(saved.images.map(image => image.name), ['tela-1.png', 'tela-3.png']);
  await restored.attach(new File([png], 'tela-4.png', { type: 'image/png' }));
  assert.equal(await save(restored, 2), 3); assert.equal(writes, 4);
  assert.deepEqual((await V.open(key, (await json('GET', null, '?id=' + id)).envelope, 'item:' + id)).images.map(image => image.name), ['tela-1.png', 'tela-3.png', 'tela-4.png']);
  assert.equal((await fetch(app.origin + '/reference-crypto.js')).status, 200);
});

test('Formato antigo de uma imagem continua válido e pode ser salvo como galeria', async () => {
  const collection = Images.create({ key, fetcher: async () => { throw new Error('Não deve carregar'); }, decodeImage });
  const entry = await collection.attach(new File([png], 'antiga.png', { type: 'image/png' }));
  const legacy = { title: 'Imagem antiga', kind: 'image', image: entry.meta };
  assert.equal(V.validateItem(legacy), legacy);
  assert.deepEqual(V.imagesOf(legacy), [entry.meta]);
  collection.restore(V.imagesOf(legacy));
  await collection.attach(new File([png], 'nova.png', { type: 'image/png' }));
  const updated = V.validateItem({ title: legacy.title, kind: legacy.kind, images: collection.metadata() });
  assert.deepEqual(updated.images.map(image => image.name), ['antiga.png', 'nova.png']);
  assert.deepEqual(V.imagesOf({ ...legacy, images: [] }), [], 'Lista nova vazia não ressuscita imagem antiga.');
  assert.throws(() => V.validateItem({ ...updated, images: [null] }));
  assert.throws(() => V.validateItem({ ...updated, images: 'inválido' }));
  assert.throws(() => V.validateItem({ ...updated, images: Array(21).fill(entry.meta) }));
  collection.close();
});

test('Imagens inválidas não apagam anexos válidos e encerramento descarta carga atrasada', async () => {
  const collection = Images.create({ key, fetcher: async () => new Response(new Uint8Array(32)), decodeImage });
  await collection.attach(new File([png], 'válida.png', { type: 'image/png' }));
  await assert.rejects(collection.attach(new File(['texto'], 'script.svg', { type: 'image/svg+xml' })));
  await assert.rejects(collection.attach(new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'grande.png', { type: 'image/png' })));
  assert.equal(collection.entries.length, 1);
  const meta = collection.metadata(); collection.restore(meta);
  await assert.rejects(collection.load(collection.entries[0]), /verificar/);
  collection.close();
  let release;
  const encrypted = await V.sealBytes(key, png, 'image');
  const delayed = Images.create({ key, fetcher: () => new Promise(resolve => { release = () => resolve(new Response(encrypted.data)); }), decodeImage });
  delayed.restore([{ ...meta[0], id: await V.hash(encrypted.data), iv: encrypted.iv }]);
  const loading = delayed.load(delayed.entries[0]); delayed.close(); release();
  assert.equal(await loading, null); assert.equal(delayed.entries.length, 0);
});
