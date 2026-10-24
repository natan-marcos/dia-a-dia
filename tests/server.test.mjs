import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { MAX_BYTES, handleState, migrateState, readState, splitPayload, writeState } from '../server/state-store.mjs';

const schema = readFileSync(new URL('../drizzle/0000_sweet_nuke.sql', import.meta.url), 'utf8');
const C = globalThis.DailyCore;
const stamp = '2026-10-24T12:00:00.000Z';
const endpoint = 'https://daily.example/api/state';

// Execute the production SQL against SQLite. D1 batches commit all statements or
// roll the entire batch back; each statement exposes D1's result/metadata shape.
class D1Statement {
  constructor(db, sql, values = []) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new D1Statement(this.db, this.sql, values); }
  execute() {
    const statement = this.db.sqlite.prepare(this.sql);
    if (statement.columns().length) {
      return { success: true, results: statement.all(...this.values).map(row => ({ ...row })), meta: { changes: 0 } };
    }
    const result = statement.run(...this.values);
    return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
  async all() { return this.execute(); }
  async first(column) {
    const row = this.execute().results[0];
    return row ? (column === undefined ? row : row[column]) : null;
  }
}

class SQLiteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys = ON');
    this.sqlite.exec(schema);
    this.beforeBatch = null;
  }
  prepare(sql) { return new D1Statement(this, sql); }
  async batch(statements) {
    if (this.beforeBatch) await this.beforeBatch();
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(statement => statement.execute());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
  close() { this.sqlite.close(); }
}

function database(t) { const db = new SQLiteD1(); t.after(() => db.close()); return db; }
function task(id = 'task-1') {
  return { id, title: 'Revisar documentação', priority: 'high', createdAt: stamp, completedAt: null, dueDate: '2026-10-25' };
}
function state(text = 'Anotação de hoje', tasks = [task()]) {
  return { schemaVersion: 1, days: { '2026-10-24': { text, updatedAt: stamp } }, tasks };
}
function input(content, baseRevision = 0, requestId = 'request_0001') { return { state: content, baseRevision, requestId }; }
function status(expected) { return error => { assert.equal(error.status, expected); return true; }; }
function snapshot(db) {
  return ['daily_documents', 'daily_chunks', 'daily_writes'].map(table =>
    db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all().map(row => ({ ...row })));
}
function twoPartyBarrier() {
  let arrivals = 0, release;
  const ready = new Promise(resolve => { release = resolve; });
  return async () => { if (++arrivals === 2) release(); await ready; };
}
function request(method, body, headers = {}) {
  return new Request(endpoint, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

test('SQLite roundtrip: primeira leitura vazia e atualização preservam notas/tarefas', async t => {
  const db = database(t);
  assert.deepEqual(await readState(db, 'alice'), { revision: 0, state: C.empty() });
  const first = state();
  assert.deepEqual(await writeState(db, 'alice', input(first)), { revision: 1, requestId: 'request_0001' });
  assert.deepEqual(await readState(db, 'alice'), { revision: 1, state: first });
  const second = state('Nota atualizada', [{ ...task(), completedAt: stamp }]);
  await writeState(db, 'alice', input(second, 1, 'request_0002'));
  assert.deepEqual(await readState(db, 'alice'), { revision: 2, state: second });
});
test('SQLite preserva tema entre leituras, alterações de notas e migração antiga', async t => {
  const db = database(t);
  const content = { ...state(), preferences: { theme: 'dark' } };
  await writeState(db, 'theme-user', input(content));
  const loaded = await readState(db, 'theme-user');
  assert.equal(loaded.state.preferences.theme, 'dark');
  loaded.state.days['2026-10-24'].text = 'Nota editada no tema escuro';
  await writeState(db, 'theme-user', input(loaded.state, loaded.revision, 'theme_update_2'));
  await migrateState(db, 'theme-user', state('Nota antiga sem preferência'));
  assert.equal((await readState(db, 'theme-user')).state.preferences.theme, 'dark');
  assert.equal((await readState(db, 'another-user')).state.preferences, undefined);
});

test('Owners, revisões e recibos são isolados, inclusive IDs contendo SQL', async t => {
  const db = database(t), alice = state('Só Alice'), bob = state('Só Bob', []), unusualOwner = "eve' OR 1=1 --";
  await writeState(db, 'alice', input(alice));
  await writeState(db, 'bob', input(bob));
  await writeState(db, unusualOwner, input(state('Só Eve', [])));
  assert.deepEqual(await readState(db, 'alice'), { revision: 1, state: alice });
  assert.deepEqual(await readState(db, 'bob'), { revision: 1, state: bob });
  assert.equal((await readState(db, unusualOwner)).state.days['2026-10-24'].text, 'Só Eve');
  assert.deepEqual(await readState(db, 'nobody'), { revision: 0, state: C.empty() });
});

test('CAS concorrente aceita um escritor; o perdedor não muda chunks, revisão ou recibos', async t => {
  const db = database(t);
  await writeState(db, 'alice', input(state('Original')));
  db.beforeBatch = twoPartyBarrier();
  const contenders = [input(state('Cliente A'), 1, 'request_A001'), input(state('Cliente B'), 1, 'request_B001')];
  const results = await Promise.allSettled(contenders.map(value => writeState(db, 'alice', value)));
  db.beforeBatch = null;
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const winnerIndex = results.findIndex(result => result.status === 'fulfilled');
  const loserIndex = 1 - winnerIndex;
  assert.equal(results[loserIndex].reason.status, 409);
  assert.deepEqual(await readState(db, 'alice'), { revision: 2, state: contenders[winnerIndex].state });
  assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM daily_writes WHERE owner_id = ?').bind('alice').first('count'), 2);
  assert.equal(await db.prepare('SELECT request_id FROM daily_writes WHERE owner_id = ? AND request_id = ?').bind('alice', contenders[loserIndex].requestId).first(), null);
  const before = snapshot(db);
  await assert.rejects(writeState(db, 'alice', input(state('Outra versão obsoleta'), 1, 'request_stale')), status(409));
  assert.deepEqual(snapshot(db), before);
});

test('Resposta perdida: repetir requestId confirma o commit original sem sobrescrever versão nova', async t => {
  const db = database(t), original = input(state('Primeira versão'));
  const committed = await writeState(db, 'alice', original);
  const newest = state('Outra alteração posterior');
  await writeState(db, 'alice', input(newest, 1, 'request_0002'));
  const before = snapshot(db);
  assert.deepEqual(await writeState(db, 'alice', original), committed);
  assert.deepEqual(await readState(db, 'alice'), { revision: 2, state: newest });
  assert.deepEqual(snapshot(db), before);
  await assert.rejects(writeState(db, 'alice', input(state('Conteúdo diferente'), 2)), status(409));
  assert.deepEqual(snapshot(db), before);
});

test('Duas tentativas simultâneas do mesmo envio geram um único commit', async t => {
  const db = database(t), value = input(state());
  db.beforeBatch = twoPartyBarrier();
  const results = await Promise.all([writeState(db, 'alice', value), writeState(db, 'alice', value)]);
  db.beforeBatch = null;
  assert.deepEqual(results[0], results[1]);
  assert.equal((await readState(db, 'alice')).revision, 1);
  assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM daily_writes').first('count'), 1);
});

test('Migração é aditiva, repetível e não ressuscita tarefa excluída após a transferência', async t => {
  const db = database(t), legacy = state('Texto antigo', [task('legacy-task')]);
  await writeState(db, 'alice', input(state('Texto no banco', [task('server-task')])));
  const migrated = await migrateState(db, 'alice', legacy);
  assert.equal(migrated.migrated, true);
  assert.equal(migrated.revision, 2);
  assert.match(migrated.state.days['2026-10-24'].text, /Texto no banco/);
  assert.match(migrated.state.days['2026-10-24'].text, /Texto antigo/);
  assert.deepEqual(migrated.state.tasks.map(value => value.id), ['server-task', 'legacy-task']);
  const afterDeletion = structuredClone(migrated.state);
  afterDeletion.tasks = afterDeletion.tasks.filter(value => value.id !== 'legacy-task');
  afterDeletion.days['2026-10-24'].text = 'Texto editado depois da migração';
  await writeState(db, 'alice', input(afterDeletion, 2, 'request_delete'));
  const before = snapshot(db);
  assert.deepEqual(await migrateState(db, 'alice', legacy), { revision: 3, state: afterDeletion, migrated: true });
  assert.deepEqual(snapshot(db), before);
});

test('Migrações concorrentes do mesmo legado não duplicam notas ou tarefas', async t => {
  const db = database(t), legacy = state('Minha nota antiga');
  db.beforeBatch = twoPartyBarrier();
  const results = await Promise.all([migrateState(db, 'alice', legacy), migrateState(db, 'alice', legacy)]);
  db.beforeBatch = null;
  assert.equal(results[0].migrated, true);
  assert.equal(results[1].migrated, true);
  assert.deepEqual(await readState(db, 'alice'), { revision: 1, state: legacy });
});

test('Unicode e nota maior que dois milhões de caracteres sobrevivem aos chunks SQLite', async t => {
  const db = database(t), boundary = 'x'.repeat(179999) + '🧠fim';
  const split = splitPayload(boundary);
  assert.equal(split.join(''), boundary);
  assert.equal(split[0].length, 179999);
  const text = '🧠é漢\n'.repeat(420001), content = state(text, []);
  assert.ok(text.length > 2_000_000);
  await writeState(db, 'alice', input(content));
  const rows = await db.prepare('SELECT position, payload FROM daily_chunks WHERE owner_id = ? ORDER BY position').bind('alice').all();
  assert.ok(rows.results.length > 1);
  for (const row of rows.results) {
    assert.ok(Buffer.byteLength(row.payload, 'utf8') < 2_000_000);
    assert.ok(!/[\uD800-\uDBFF]$/.test(row.payload), 'Um chunk não termina na metade de um emoji');
    assert.ok(!/^[\uDC00-\uDFFF]/.test(row.payload), 'Um chunk não começa na metade de um emoji');
  }
  assert.deepEqual(await readState(db, 'alice'), { revision: 1, state: content });
});

test('Limite do estado considera bytes UTF-8 e rejeita sem alterar dados anteriores', async t => {
  const db = database(t);
  await writeState(db, 'alice', input(state('Preservar')));
  const before = snapshot(db), oversized = state('é'.repeat(MAX_BYTES / 2), []);
  assert.ok(oversized.days['2026-10-24'].text.length < MAX_BYTES);
  await assert.rejects(writeState(db, 'alice', input(oversized, 1, 'request_large')), status(413));
  assert.deepEqual(snapshot(db), before);
});

test('Erro SQLite após CAS e DELETE reverte o batch inteiro e permite repetir o envio', async t => {
  const db = database(t);
  await writeState(db, 'alice', input(state('Conteúdo durável')));
  const before = snapshot(db);
  db.sqlite.exec("CREATE TEMP TRIGGER reject_chunk BEFORE INSERT ON daily_chunks WHEN instr(NEW.payload, 'fail-marker') > 0 BEGIN SELECT RAISE(ABORT, 'injected chunk failure'); END");
  const failing = input(state('fail-marker: nova nota'), 1, 'request_retry');
  await assert.rejects(writeState(db, 'alice', failing), /injected chunk failure/);
  assert.deepEqual(snapshot(db), before);
  db.sqlite.exec('DROP TRIGGER reject_chunk');
  assert.equal((await writeState(db, 'alice', failing)).revision, 2);
  assert.deepEqual((await readState(db, 'alice')).state, failing.state);
});

test('HTTP exige autenticação em GET/PUT/POST e retorna 503 sem binding do banco', async t => {
  const db = database(t);
  for (const method of ['GET', 'PUT', 'POST']) {
    const response = await handleState(request(method, method === 'GET' ? undefined : input(state())), db, null);
    assert.equal(response.status, 401);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
  assert.equal((await handleState(request('GET'), null, 'alice')).status, 503);
  assert.deepEqual(snapshot(db), [[], [], []]);
});

test('HTTP GET/PUT isola owners e bloqueia Origin externo ou Sec-Fetch-Site cross-site', async t => {
  const db = database(t), content = state('Somente Alice');
  const headersToReject = [
    { origin: 'https://attacker.example' },
    { origin: 'null' },
    { origin: 'https://daily.example', 'sec-fetch-site': 'cross-site' },
  ];
  for (const headers of headersToReject) {
    assert.equal((await handleState(request('PUT', input(content), headers), db, 'alice')).status, 403);
    assert.equal((await handleState(request('POST', { state: content }, headers), db, 'alice')).status, 403);
  }
  assert.deepEqual(snapshot(db), [[], [], []]);
  const saved = await handleState(request('PUT', { ...input(content), owner: 'bob' }, { origin: 'https://daily.example' }), db, 'alice');
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { revision: 1, requestId: 'request_0001' });
  const fetched = await handleState(request('GET'), db, 'alice');
  assert.equal(fetched.status, 200);
  assert.match(fetched.headers.get('cache-control'), /no-store/);
  assert.equal(fetched.headers.get('vary'), 'Cookie');
  assert.deepEqual(await fetched.json(), { revision: 1, state: content });
  assert.deepEqual(await (await handleState(request('GET'), db, 'bob')).json(), { revision: 0, state: C.empty() });
  const stale = await handleState(request('PUT', input(state('Obsoleta'), 0, 'request_stale'), { origin: 'https://daily.example' }), db, 'alice');
  assert.equal(stale.status, 409);
  assert.deepEqual((await readState(db, 'alice')).state, content);
});

test('HTTP rejeita JSON inválido, tipo incorreto e schema inválido sem gravar', async t => {
  const db = database(t);
  const invalidJSON = new Request(endpoint, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal((await handleState(invalidJSON, db, 'alice')).status, 400);
  const wrongType = new Request(endpoint, { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal((await handleState(wrongType, db, 'alice')).status, 415);
  assert.equal((await handleState(request('PUT', input({ schemaVersion: 99 })), db, 'alice')).status, 422);
  assert.equal((await handleState(request('DELETE'), db, 'alice')).status, 405);
  assert.deepEqual(snapshot(db), [[], [], []]);
});

for (const method of ['PUT', 'POST']) {
  test(`HTTP ${method} trata JSON null como erro de entrada 400, sem indicar indisponibilidade do banco`, async t => {
    const db = database(t);
    const response = await handleState(request(method, null), db, 'alice');
    assert.equal(response.status, 400, `${method} null deve ser rejeitado como entrada inválida`);
    assert.deepEqual(snapshot(db), [[], [], []]);
  });
}
