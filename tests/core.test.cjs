const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../public/core.js');
const C = globalThis.DailyCore;
const task = (id, extra = {}) => ({ id, title: 'Revisar documentação', priority: 'normal', dueDate: '', createdAt: '2026-10-24T12:00:00.000Z', completedAt: null, ...extra });
test('Datas locais e navegação atravessam meses e anos sem perder um dia', () => {
  assert.equal(C.dateKey(new Date(2026, 9, 24, 23, 59)), '2026-10-24');
  assert.equal(C.shiftDate('2026-03-01', -1), '2026-02-28');
  assert.equal(C.shiftDate('2026-12-31', 1), '2027-01-01');
  assert.equal(C.isDate('2026-02-30'), false); assert.equal(C.isDate('2024-02-29'), true);
});
test('Notas e tarefas sobrevivem à serialização de armazenamento', () => {
  const state = C.empty(); state.days['2026-10-24'] = { text: 'Ação de hoje\n• Resolver pendências', updatedAt: '2026-10-24T12:00:00Z' }; state.tasks.push(task('1'));
  assert.deepEqual(C.validate(JSON.parse(JSON.stringify(state))), state);
});
test('Pendências persistem em dias seguintes e conclusão usa o dia local', () => {
  const state = C.empty(); state.tasks = [task('1'), task('2', { priority: 'high' }), task('3', { completedAt: new Date(2026, 9, 24, 13).toISOString() })];
  assert.deepEqual(C.stats(state, '2026-10-24'), { open: 2, priority: 1, doneToday: 1 });
  assert.deepEqual(C.stats(state, '2026-10-25'), { open: 2, priority: 1, doneToday: 0 });
  assert.equal(C.visibleTasks(state, 'open').length, 2);
});
test('Backup inválido não altera o estado e IDs duplicados são rejeitados', () => {
  const state = C.empty(); state.tasks.push(task('1')); const before = JSON.stringify(state);
  assert.throws(() => C.merge(state, { schemaVersion: 8, days: {}, tasks: [] }));
  assert.throws(() => C.validate({ schemaVersion: 1, days: {}, tasks: [task('1'), task('1')] }));
  assert.throws(() => C.validate({ schemaVersion: 1, days: { '__proto__': 'x', 'oops': { text: 'x' } }, tasks: [] }));
  assert.equal(JSON.stringify(state), before);
});
test('Restauração é aditiva e repetir o mesmo backup não duplica dados', () => {
  const current = C.empty(); current.days['2026-10-24'] = { text: 'Anotação atual', updatedAt: '2026-10-24T12:00:00Z' }; current.tasks.push(task('1', { completedAt: '2026-10-24T13:00:00Z' }));
  const backup = C.empty(); backup.days['2026-10-24'] = { text: 'Anotação antiga', updatedAt: '2026-10-24T10:00:00Z' }; backup.tasks = [task('1'), task('2')];
  const first = C.merge(current, backup); const second = C.merge(first.state, backup);
  assert.equal(first.state.tasks.length, 2); assert.equal(first.state.tasks[0].completedAt, '2026-10-24T13:00:00Z');
  assert.ok(first.state.days['2026-10-24'].text.includes('Anotação atual')); assert.ok(first.state.days['2026-10-24'].text.includes('Anotação antiga'));
  assert.deepEqual(second.state, first.state); assert.equal(second.daysAdded, 0); assert.equal(second.tasksAdded, 0);
});
test('Busca ignora acentos e prioridade/prazo ordenam a lista', () => {
  const state = C.empty(); state.tasks = [task('a'), task('b', { dueDate: '2026-10-23' }), task('c', { priority: 'high' })];
  assert.deepEqual(C.visibleTasks(state, 'open', 'documentacao').map(t => t.id), ['c', 'b', 'a']);
  assert.equal(C.visibleTasks(state, 'done').length, 0);
});
test('Notas longas mescladas continuam válidas ao recarregar', () => {
  const current = C.empty(), incoming = C.empty();
  current.days['2026-10-24'] = { text: 'a'.repeat(1000000), updatedAt: '2026-10-24T12:00:00Z' };
  incoming.days['2026-10-24'] = { text: 'b'.repeat(1000000), updatedAt: '2026-10-24T12:00:00Z' };
  const merged = C.merge(current, incoming).state;
  assert.ok(merged.days['2026-10-24'].text.length > 2000000);
  assert.deepEqual(C.validate(JSON.parse(JSON.stringify(merged))), merged);
});
test('Preferência de tema aceita backups antigos e preserva a escolha atual na restauração', () => {
  const oldBackup = C.empty();
  assert.deepEqual(C.validate(oldBackup), oldBackup);
  const dark = { ...C.empty(), preferences: { theme: 'dark' } };
  const light = { ...C.empty(), preferences: { theme: 'light' } };
  assert.deepEqual(C.validate(dark), dark);
  assert.equal(C.merge(dark, light).state.preferences.theme, 'dark');
  assert.equal(C.merge(oldBackup, dark).state.preferences.theme, 'dark');
  assert.throws(() => C.validate({ ...C.empty(), preferences: { theme: 'invalid' } }));
});
