(function (root) {
  'use strict';
  const STORAGE_KEY = 'dia-a-dia.v1';
  const dateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const isDate = value => typeof value === 'string' && /^20\d\d-\d{2}-\d{2}$|^2100-\d{2}-\d{2}$/.test(value) && dateKey(new Date(value + 'T12:00:00')) === value;
  const shiftDate = (key, amount) => { const d = new Date(key + 'T12:00:00'); d.setDate(d.getDate() + amount); return dateKey(d); };
  const empty = () => ({ schemaVersion: 1, days: {}, tasks: [] });
  const uid = () => root.crypto?.randomUUID?.() || `item-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const isTime = value => typeof value === 'string' && value.length < 50 && Number.isFinite(Date.parse(value));
  function validate(input) {
    if (!input || input.schemaVersion !== 1 || !input.days || typeof input.days !== 'object' || Array.isArray(input.days) || !Array.isArray(input.tasks)) throw new Error('Este arquivo não é um backup válido do Dia a dia.');
    if (Object.keys(input.days).length > 40000 || input.tasks.length > 50000) throw new Error('Este backup é grande demais.');
    const result = empty();
    if (input.preferences !== undefined) {
      if (!input.preferences || !['light', 'dark'].includes(input.preferences.theme)) throw new Error('O backup contém uma preferência de tema inválida.');
      result.preferences = { theme: input.preferences.theme };
    }
    for (const [key, day] of Object.entries(input.days)) {
      if (!isDate(key) || !day || typeof day.text !== 'string' || !isTime(day.updatedAt)) throw new Error('O backup contém uma daily inválida. Nenhum dado foi alterado.');
      result.days[key] = { text: day.text, updatedAt: day.updatedAt };
    }
    const ids = new Set();
    for (const task of input.tasks) {
      if (!task || typeof task.id !== 'string' || !task.id || task.id.length > 150 || ids.has(task.id) || typeof task.title !== 'string' || !task.title.trim() || task.title.length > 500 || !['normal', 'high'].includes(task.priority) || !isTime(task.createdAt) || (task.completedAt !== null && !isTime(task.completedAt)) || (task.dueDate !== '' && !isDate(task.dueDate))) throw new Error('O backup contém uma tarefa inválida. Nenhum dado foi alterado.');
      ids.add(task.id);
      result.tasks.push({ id: task.id, title: task.title, priority: task.priority, createdAt: task.createdAt, completedAt: task.completedAt, dueDate: task.dueDate });
    }
    return result;
  }
  function merge(current, incoming) {
    const merged = validate(current);
    const extra = validate(incoming);
    if (!merged.preferences && extra.preferences) merged.preferences = { ...extra.preferences };
    let daysAdded = 0, tasksAdded = 0;
    for (const [key, day] of Object.entries(extra.days)) {
      if (!day.text.trim()) continue;
      const prior = merged.days[key];
      if (!prior?.text.trim()) { merged.days[key] = day; daysAdded++; }
      else if (prior.text !== day.text && !prior.text.includes(day.text)) { merged.days[key] = { text: prior.text + '\n\n— Anotação recuperada do backup —\n' + day.text, updatedAt: new Date().toISOString() }; daysAdded++; }
    }
    const existingIds = new Set(merged.tasks.map(task => task.id));
    for (const task of extra.tasks) {
      // Existing IDs retain the current version, so restoring an old backup never reopens completed tasks.
      if (!existingIds.has(task.id)) { merged.tasks.push(task); existingIds.add(task.id); tasksAdded++; }
    }
    return { state: validate(merged), daysAdded, tasksAdded };
  }
  function stats(state, today) {
    return { open: state.tasks.filter(t => !t.completedAt).length, priority: state.tasks.filter(t => !t.completedAt && t.priority === 'high').length, doneToday: state.tasks.filter(t => t.completedAt && dateKey(new Date(t.completedAt)) === today).length };
  }
  function visibleTasks(state, filter, query = '') {
    const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
    const term = normalize(query.trim());
    return state.tasks.filter(t => (filter === 'done' ? !!t.completedAt : !t.completedAt) && normalize(t.title).includes(term)).sort((a, b) => {
      if (filter === 'done') return b.completedAt.localeCompare(a.completedAt);
      return Number(b.priority === 'high') - Number(a.priority === 'high') || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || b.createdAt.localeCompare(a.createdAt);
    });
  }
  root.DailyCore = { STORAGE_KEY, dateKey, isDate, shiftDate, empty, uid, validate, merge, stats, visibleTasks };
})(typeof globalThis !== 'undefined' ? globalThis : window);
