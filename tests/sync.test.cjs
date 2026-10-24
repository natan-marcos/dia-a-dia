const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../public/core.js');
require('../public/sync.js');
const C = globalThis.DailyCore, create = globalThis.DailySync.create;
const snapshot = text => ({ schemaVersion: 1, days: { '2026-10-24': { text, updatedAt: '2026-10-24T12:00:00Z' } }, tasks: [] });
const response = value => Response.json(value);
const turn = () => new Promise(resolve => setImmediate(resolve));
test('Falha no carregamento inicial nunca envia um estado vazio', async () => {
  const calls = [], sync = create({ fetcher: async (_, options) => { calls.push(options.method); throw new Error('offline'); } });
  await assert.rejects(sync.load()); assert.equal(sync.loaded, false); assert.equal(sync.save(snapshot('novo')), false); await sync.flush();
  assert.deepEqual(calls, ['GET']);
});
test('Digitação durante um envio lento é salva em sequência sem confirmar texto antigo', async () => {
  let release; const sent = [], statuses = [];
  const sync = create({ delay: 100000, onStatus: s => statuses.push(s), fetcher: async (_, options) => {
    if (options.method === 'GET') return response({ revision: 0, state: C.empty() });
    const body = JSON.parse(options.body); sent.push(body);
    if (sent.length === 1) await new Promise(resolve => { release = resolve; });
    return response({ revision: sent.length, requestId: body.requestId });
  } });
  await sync.load(); sync.save(snapshot('primeiro')); const done = sync.flush(); await turn();
  sync.save(snapshot('primeiro e segundo')); assert.equal(sync.dirty, true); release(); assert.equal(await done, true);
  assert.equal(sent.length, 2); assert.equal(sent[1].baseRevision, 1); assert.equal(sent[1].state.days['2026-10-24'].text, 'primeiro e segundo');
  assert.equal(sync.dirty, false); assert.equal(statuses.at(-1).kind, 'saved');
});
test('Resposta perdida repete o mesmo requestId antes de enviar o rascunho mais recente', async () => {
  const sent = []; let first = true;
  const sync = create({ delay: 100000, fetcher: async (_, options) => {
    if (options.method === 'GET') return response({ revision: 0, state: C.empty() });
    const body = JSON.parse(options.body); sent.push(body);
    if (first) { first = false; throw new Error('response lost after commit'); }
    return response({ revision: sent.length - 1, requestId: body.requestId });
  } });
  await sync.load(); sync.save(snapshot('A')); assert.equal(await sync.flush(), false); assert.equal(sync.dirty, true);
  sync.save(snapshot('B')); assert.equal(await sync.retry(), true);
  assert.deepEqual(sent[0], sent[1]); assert.equal(sent[2].state.days['2026-10-24'].text, 'B'); assert.equal(sync.dirty, false);
});
test('Conflito mantém o rascunho e nunca sobrescreve outra versão automaticamente', async () => {
  const kinds = []; let writes = 0;
  const sync = create({ delay: 100000, onStatus: s => kinds.push(s.kind), fetcher: async (_, options) => {
    if (options.method === 'GET') return response({ revision: 4, state: C.empty() });
    writes++; return Response.json({ error: 'Conflito' }, { status: 409 });
  } });
  await sync.load(); sync.save(snapshot('meu rascunho')); assert.equal(await sync.flush(), false);
  assert.equal(sync.dirty, true); assert.equal(await sync.retry(), false); await sync.refresh(); assert.equal(writes, 1); assert.equal(kinds.at(-1), 'conflict');
});
test('Leitura de fundo atrasada não substitui uma edição iniciada enquanto ela estava em andamento', async () => {
  let release, reads = 0; const seen = [], writes = [];
  const sync = create({ delay: 100000, onState: state => seen.push(state), fetcher: async (_, options) => {
    if (options.method === 'GET') { reads++; if (reads > 1) return new Promise(resolve => { release = () => resolve(response({ revision: 1, state: snapshot('outro dispositivo') })); }); return response({ revision: 0, state: C.empty() }); }
    const body = JSON.parse(options.body); writes.push(body); return Response.json({ error: 'conflito' }, { status: 409 });
  } });
  await sync.load(); const refreshing = sync.refresh(); await turn(); sync.save(snapshot('rascunho local')); release(); await refreshing;
  assert.equal(seen.length, 1); assert.equal(sync.dirty, true); await sync.flush(); assert.equal(writes[0].baseRevision, 0);
});
test('Rascunho corrigido substitui um envio rejeitado por tamanho', async () => {
  const sent = [];
  const sync = create({ delay: 100000, fetcher: async (_, options) => {
    if (options.method === 'GET') return response({ revision: 0, state: C.empty() });
    const body = JSON.parse(options.body); sent.push(body);
    if (body.state.days['2026-10-24'].text === 'grande') return Response.json({ error: 'Muito grande' }, { status: 413 });
    return response({ revision: 1, requestId: body.requestId });
  } });
  await sync.load(); sync.save(snapshot('grande')); assert.equal(await sync.flush(), false);
  sync.save(snapshot('corrigido')); assert.equal(await sync.retry(), true);
  assert.deepEqual(sent.map(s => s.state.days['2026-10-24'].text), ['grande', 'corrigido']); assert.equal(sync.dirty, false);
});
test('Leitura iniciada antes da migração não apaga os dados recém-transferidos da tela', async () => {
  let release, reads = 0; const seen = [];
  const sync = create({ onState: state => seen.push(state), fetcher: async (_, options) => {
    if (options.method === 'POST') return response({ revision: 1, state: snapshot('transferido'), migrated: true });
    reads++; if (reads > 1) return new Promise(resolve => { release = () => resolve(response({ revision: 0, state: C.empty() })); });
    return response({ revision: 0, state: C.empty() });
  } });
  await sync.load(); const refreshing = sync.refresh(); await turn(); await sync.migrate(snapshot('transferido')); release(); await refreshing;
  assert.equal(seen.length, 2); assert.equal(seen.at(-1).days['2026-10-24'].text, 'transferido');
});
