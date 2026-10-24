(() => {
  'use strict';
  const C = window.DailyCore;
  const $ = id => document.getElementById(id);
  const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  let state = C.empty(), today = C.dateKey(), selectedDate = today, followToday = true;
  let filter = 'open', editingId = null, toastTimer, undoAction = null, importDate = today;
  let readOnly = true, starting = false;
  const shortDate = key => new Date(key + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
  const longDate = key => new Date(key + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  const compactDate = key => new Date(key + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
  const sync = window.DailySync.create({
    onState(next) {
      state = next;
      applyTheme();
      const notes = $('daily-notes'), start = notes.selectionStart, end = notes.selectionEnd;
      const text = state.days[selectedDate]?.text || '';
      if (notes.value !== text) { notes.value = text; notes.setSelectionRange(Math.min(start, text.length), Math.min(end, text.length)); }
      renderTasks();
    },
    onStatus({ kind, message }) {
      const failed = ['error', 'conflict', 'auth'].includes(kind);
      $('storage-warning').hidden = !failed;
      $('warning-text').textContent = message;
      $('retry-save').hidden = kind === 'conflict' || kind === 'auth';
      $('resolve-conflict').hidden = kind !== 'conflict';

      $('save-state').textContent = kind === 'saved' ? 'Salvo' : kind === 'saving' ? 'Salvando…' : kind === 'loading' ? 'Carregando suas anotações…' : 'Não salvo · confira o aviso';
    },
  });
  function persist() {
    if (readOnly) return false;
    try {
      return sync.save(state);
    } catch (error) {
      $('storage-warning').hidden = false; $('warning-text').textContent = error.message;
      return false;
    }
  }
  function applyTheme() {
    const theme = state.preferences?.theme || 'light';
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#161c19' : '#f5f5f0';
    document.querySelectorAll('[data-theme-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme)));
  }
  document.querySelectorAll('[data-theme-choice]').forEach(button => button.addEventListener('click', () => {
    if (readOnly) return;
    state.preferences = { theme: button.dataset.themeChoice };
    applyTheme(); persist();
  }));
  function toast(message, undo = null) {
    clearTimeout(toastTimer); undoAction = undo;
    $('toast-message').textContent = message; $('toast-undo').hidden = !undo; $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; undoAction = null; }, undo ? 11000 : 5000);
  }
  $('toast-close').onclick = () => { $('toast').hidden = true; clearTimeout(toastTimer); undoAction = null; };
  $('toast-undo').onclick = () => { const action = undoAction; undoAction = null; if (action) action(); $('toast').hidden = true; clearTimeout(toastTimer); };
  function updateToday() {
    const nextToday = C.dateKey();
    if (today !== nextToday) { today = nextToday; if (followToday) selectDate(today, true); renderTasks(); }
    $('today-weekday').textContent = new Date(today + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long' });
    $('today-long').textContent = longDate(today);
    renderDate();
  }
  function renderDate() {
    $('daily-date').value = selectedDate;
    $('selected-date-label').textContent = shortDate(selectedDate) + (selectedDate.slice(0, 4) !== today.slice(0, 4) ? ' de ' + selectedDate.slice(0, 4) : '');
    $('date-badge').textContent = selectedDate === today ? 'HOJE' : selectedDate < today ? 'HISTÓRICO' : 'PRÓXIMOS DIAS';
    $('date-badge').classList.toggle('past', selectedDate !== today);
    $('go-today').disabled = selectedDate === today;
    $('previous-day').disabled = selectedDate <= '2000-01-01';
    $('next-day').disabled = selectedDate >= '2100-12-31';
  }
  function selectDate(date, following = false) {
    if (!C.isDate(date)) return;
    selectedDate = date; followToday = following;
    $('daily-notes').value = state.days[date]?.text || '';
    renderDate();
  }
  function saveNote() {
    state.days[selectedDate] = { text: $('daily-notes').value, updatedAt: new Date().toISOString() };
    persist();
  }
  $('daily-notes').addEventListener('input', saveNote);
  $('daily-date').addEventListener('change', e => selectDate(e.target.value, e.target.value === today));
  $('previous-day').onclick = () => selectDate(C.shiftDate(selectedDate, -1));
  $('next-day').onclick = () => selectDate(C.shiftDate(selectedDate, 1));
  $('go-today').onclick = () => selectDate(today, true);
  $('brand-home').onclick = e => { e.preventDefault(); selectDate(today, true); };
  $('use-template').onclick = () => {
    const current = $('daily-notes').value;
    const template = 'O que fiz\n• \n\nO que vou fazer\n• \n\nBloqueios / pontos de atenção\n• ';
    $('daily-notes').value = current + (current.trim() ? '\n\n' : '') + template;
    saveNote(); $('daily-notes').focus();
    const offset = current.length + (current.trim() ? 2 : 0) + 'O que fiz\n• '.length;
    $('daily-notes').setSelectionRange(offset, offset);
    toast('Roteiro inserido.');
  };
  function download(content, filename, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  $('copy-daily').onclick = async () => {
    const text = $('daily-notes').value;
    if (!text.trim()) { toast('Escreva sua daily antes de copiar.'); $('daily-notes').focus(); return; }
    const contents = `Daily · ${longDate(selectedDate)}\n\n${text}`;
    try { await navigator.clipboard.writeText(contents); toast('Daily copiada.'); }
    catch { download(contents, `daily-${selectedDate}.txt`, 'text/plain;charset=utf-8'); toast('Não foi possível copiar. Baixamos sua daily em TXT.'); }
  };
  function button(action, label, symbol, extra = '') {
    const b = document.createElement('button'); b.type = 'button'; b.className = `icon-button ${extra}`; b.dataset.action = action; b.title = label; b.setAttribute('aria-label', label); b.innerHTML = icon(symbol); return b;
  }
  function renderTasks() {
    const s = C.stats(state, today);
    $('stat-open').textContent = s.open; $('stat-priority').textContent = s.priority; $('stat-done').textContent = s.doneToday;
    $('pending-count').textContent = s.open; $('tab-open-count').textContent = s.open; $('tab-done-count').textContent = state.tasks.length - s.open;
    const denominator = s.open + s.doneToday, progress = denominator ? Math.round(s.doneToday / denominator * 100) : 0;
    $('progress-detail').textContent = denominator ? `${s.doneToday} de ${denominator} ${denominator === 1 ? 'tarefa concluída' : 'tarefas concluídas'}` : '0 tarefas';
    $('progress-fill').style.width = progress + '%'; $('progress-track').setAttribute('aria-valuenow', progress);
    const tasks = C.visibleTasks(state, filter, $('task-search').value);
    const list = $('task-list'); const active = document.activeElement;
    const focusTask = active?.closest('[data-id]')?.dataset.id, focusAction = active?.dataset.action;
    list.replaceChildren();
    for (const task of tasks) {
      const row = document.createElement('div'); row.className = 'task-row' + (task.completedAt ? ' completed' : ''); row.dataset.id = task.id;
      const check = button('toggle', `${task.completedAt ? 'Reabrir' : 'Concluir'}: ${task.title}`, 'check'); check.className = 'task-checkbox';
      check.setAttribute('role', 'checkbox'); check.setAttribute('aria-checked', String(!!task.completedAt)); if (!task.completedAt) check.replaceChildren();
      const copy = document.createElement('div'); copy.className = 'task-copy';
      const title = document.createElement('p'); title.className = 'task-title'; title.textContent = task.title; copy.append(title);
      const tags = document.createElement('div'); tags.className = 'task-meta';
      function tag(text, kind = '') { const span = document.createElement('span'); span.className = 'task-tag ' + kind; span.textContent = text; tags.append(span); }
      if (task.priority === 'high' && !task.completedAt) tag('Prioridade alta', 'priority');
      if (task.completedAt) tag('Concluída em ' + compactDate(C.dateKey(new Date(task.completedAt))));
      else if (task.dueDate) { const overdue = task.dueDate < today; tag(overdue ? `Atrasada · ${compactDate(task.dueDate)}` : task.dueDate === today ? 'Prazo: hoje' : `Até ${compactDate(task.dueDate)}`, overdue ? 'overdue' : ''); }
      if (tags.children.length) copy.append(tags);
      const actions = document.createElement('div'); actions.className = 'task-actions';
      if (!task.completedAt) { const flag = button('priority', task.priority === 'high' ? 'Remover prioridade' : 'Marcar como prioridade', 'flag', task.priority === 'high' ? 'flagged' : ''); flag.setAttribute('aria-pressed', String(task.priority === 'high')); actions.append(flag); }
      actions.append(button('edit', 'Editar pendência', 'edit'), button('delete', 'Excluir pendência', 'trash', 'delete-task'));
      row.append(check, copy, actions); if (readOnly) row.querySelectorAll('button').forEach(b => b.disabled = true); list.append(row);
    }
    if (focusTask) {
      const targetRow = Array.from(list.children).find(row => row.dataset.id === focusTask);
      const focusTarget = targetRow && Array.from(targetRow.querySelectorAll('button')).find(b => b.dataset.action === focusAction);
      if (focusTarget) focusTarget.focus({ preventScroll: true });
      else if (focusAction === 'toggle' || focusAction === 'delete') (list.querySelector('button') || $('filter-' + filter)).focus({ preventScroll: true });
    }
    $('empty-state').hidden = !!tasks.length; list.hidden = !tasks.length;
    const searching = !!$('task-search').value.trim();
    $('empty-add').hidden = filter === 'done' || searching;
    if (searching) { $('empty-title').textContent = 'Nenhum resultado'; $('empty-description').textContent = 'Tente outra busca ou filtro.'; }
    else if (filter === 'done') { $('empty-title').textContent = 'Nenhuma tarefa concluída'; $('empty-description').textContent = ''; }
    else if (state.tasks.length) { $('empty-title').textContent = 'Nenhuma pendência'; $('empty-description').textContent = ''; $('empty-add').innerHTML = icon('plus') + 'Adicionar pendência'; }
    else { $('empty-title').textContent = 'Nenhuma pendência'; $('empty-description').textContent = ''; $('empty-add').innerHTML = icon('plus') + 'Adicionar pendência'; }
  }
  function changeFilter(next) {
    filter = next;
    document.querySelectorAll('[data-filter]').forEach(b => { b.classList.toggle('active', b.dataset.filter === filter); b.setAttribute('aria-pressed', String(b.dataset.filter === filter)); });
    renderTasks();
  }
  document.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => changeFilter(b.dataset.filter));
  $('task-form').onsubmit = e => {
    e.preventDefault(); const title = $('new-task').value.trim(); if (!title) { $('new-task').value = ''; $('new-task').focus(); return; }
    state.tasks.push({ id: C.uid(), title, priority: 'normal', dueDate: '', createdAt: new Date().toISOString(), completedAt: null });
    $('new-task').value = ''; $('task-search').value = ''; persist(); changeFilter('open'); $('new-task').focus(); $('task-list').scrollTop = 0;
  };
  $('empty-add').onclick = () => $('new-task').focus();
  $('task-search').oninput = renderTasks;
  $('search-toggle').onclick = () => { const opening = $('search-box').hidden; $('search-box').hidden = !opening; $('search-toggle').setAttribute('aria-expanded', String(opening)); if (opening) $('task-search').focus(); else { $('task-search').value = ''; renderTasks(); } };
  $('task-list').onclick = e => {
    const b = e.target.closest('button[data-action]'), row = b?.closest('[data-id]'); if (!row) return;
    const task = state.tasks.find(t => t.id === row.dataset.id); if (!task) return;
    if (b.dataset.action === 'toggle') {
      const previous = task.completedAt; task.completedAt = previous ? null : new Date().toISOString(); persist(); renderTasks();
      toast(previous ? 'Pendência reaberta.' : 'Pendência concluída.', () => { const t = state.tasks.find(t => t.id === task.id); if (t) { t.completedAt = previous; persist(); renderTasks(); } });
    } else if (b.dataset.action === 'priority') { task.priority = task.priority === 'high' ? 'normal' : 'high'; persist(); renderTasks(); }
    else if (b.dataset.action === 'edit') {
      editingId = task.id; $('edit-title').value = task.title; $('edit-priority').value = task.priority; $('edit-due').value = task.dueDate; $('edit-dialog').showModal();
    } else if (b.dataset.action === 'delete') {
      const index = state.tasks.findIndex(t => t.id === task.id); state.tasks.splice(index, 1); persist(); renderTasks();
      toast('Pendência excluída.', () => { if (!state.tasks.some(t => t.id === task.id)) { state.tasks.splice(index, 0, task); persist(); renderTasks(); } });
    }
  };
  $('edit-form').onsubmit = e => {
    e.preventDefault(); const title = $('edit-title').value.trim(), task = state.tasks.find(t => t.id === editingId);
    if (!title) { $('edit-title').focus(); return; }
    if (!task) { $('edit-dialog').close(); toast('Essa tarefa já não está na lista.'); return; }
    task.title = title; task.priority = $('edit-priority').value; task.dueDate = $('edit-due').value;
    persist(); renderTasks(); $('edit-dialog').close(); toast('Pendência atualizada.');
  };
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', e => { if (e.target !== dialog) return; const rect = dialog.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) dialog.close(); }));
  $('history-open').onclick = () => {
    const list = $('history-list'); list.replaceChildren();
    const entries = Object.entries(state.days).filter(([, day]) => day.text.trim()).sort(([a], [b]) => b.localeCompare(a));
    for (const [key, day] of entries) { const entry = document.createElement('button'); entry.className = 'history-entry'; const title = document.createElement('strong'); title.textContent = longDate(key) + (key === today ? ' · Hoje' : ''); const preview = document.createElement('span'); preview.textContent = day.text.replace(/\s+/g, ' ').slice(0, 110); entry.append(title, preview); entry.onclick = () => { selectDate(key, key === today); $('history-dialog').close(); }; list.append(entry); }
    if (!entries.length) { const message = document.createElement('p'); message.className = 'history-empty'; message.textContent = 'Nenhuma daily salva.'; list.append(message); }
    $('history-dialog').showModal();
  };
  $('backup-open').onclick = () => $('data-dialog').showModal();
  $('export-backup').onclick = () => { download(JSON.stringify({ ...state, exportedAt: new Date().toISOString(), app: 'Dia a dia' }, null, 2), `dia-a-dia-backup-${C.dateKey()}.json`, 'application/json'); toast('Backup preparado para download.'); };
  $('import-backup').onclick = () => { $('backup-file').value = ''; $('backup-file').click(); };
  $('backup-file').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 50 * 1024 * 1024) { toast('O backup deve ter até 50 MB.'); return; }
    try {
      const incoming = C.validate(JSON.parse(await file.text()));
      const merged = C.merge(state, incoming);
      if (readOnly) { toast('Espere suas anotações carregarem antes de importar.'); return; }
      state = merged.state; applyTheme(); persist(); selectDate(selectedDate, followToday); renderTasks(); $('data-dialog').close();
      const saved = await sync.flush();
      toast(saved ? (merged.daysAdded || merged.tasksAdded ? `Backup restaurado: ${merged.daysAdded} dailys e ${merged.tasksAdded} tarefas adicionadas.` : 'Esses dados já estão aqui. Nada foi duplicado.') : 'Dados recuperados nesta sessão. Baixe um backup antes de sair.');
    } catch (error) { toast(error instanceof SyntaxError ? 'Arquivo inválido. Escolha um backup JSON do Dia a dia.' : error.message); }
  };
  $('import-text').onclick = () => { $('text-file').value = ''; importDate = selectedDate; $('text-file').click(); };
  $('text-file').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast('O arquivo TXT deve ter até 2 MB.'); return; }
    try {
      const buffer = await file.arrayBuffer(); const bytes = new Uint8Array(buffer);
      const encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
      let text = new TextDecoder(encoding).decode(buffer);
      if (encoding === 'utf-8' && text.includes('\ufffd')) text = new TextDecoder('windows-1252').decode(buffer);
      if (!text.trim()) { toast('Esse arquivo está vazio.'); return; }
      $('import-preview').value = text;
      $('import-description').textContent = `Revise o texto abaixo. Ele será acrescentado à daily de ${longDate(importDate)}, preservando suas anotações.`;
      $('data-dialog').close(); $('import-dialog').showModal();
    } catch { toast('Não foi possível ler o arquivo. Tente um arquivo TXT.'); }
  };
  $('confirm-import').onclick = async () => {
    const text = $('import-preview').value.trim(); if (!text) { $('import-preview').focus(); return; }
    const previous = state.days[importDate]?.text || '';
    state.days[importDate] = { text: previous + (previous.trim() ? '\n\n' : '') + text, updatedAt: new Date().toISOString() };
    persist(); selectDate(importDate, importDate === today); $('import-dialog').close(); const saved = await sync.flush(); toast(saved ? 'Salvo.' : 'Texto ainda não salvo. Tente novamente antes de sair.');
  };
  document.addEventListener('keydown', async e => {
    if ($('daily-view').hidden) return;
    const typing = e.target.matches('input, textarea, select, [contenteditable="true"]');
    if (e.key.toLowerCase() === 'n' && !typing && !e.ctrlKey && !e.altKey && !e.metaKey && !document.querySelector('dialog[open]')) { e.preventDefault(); $('new-task').focus(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (!readOnly && await sync.retry()) toast('Salvo.'); }
  });
  function setReadOnly(value) {
    readOnly = value; $('daily-notes').readOnly = value; $('new-task').disabled = value;
    document.querySelectorAll('.add-button, #use-template, #import-backup, #import-text, #confirm-import, #edit-form button[type="submit"], [data-theme-choice]').forEach(b => b.disabled = value);
    renderTasks();
  }
  async function transferLegacy() {
    let raw;
    try { raw = localStorage.getItem(C.STORAGE_KEY); } catch { return; }
    if (!raw) { $('legacy-banner').hidden = true; return; }
    $('legacy-banner').hidden = false;
    $('legacy-message').textContent = 'Transferindo suas anotações antigas para este computador…';
    $('transfer-legacy').disabled = true;
    try {
      await sync.migrate(C.validate(JSON.parse(raw)));
      // The previous copy is removed only after a confirmed commit and if unchanged.
      if (localStorage.getItem(C.STORAGE_KEY) === raw) localStorage.removeItem(C.STORAGE_KEY);
      $('legacy-banner').hidden = !localStorage.getItem(C.STORAGE_KEY);
      $('legacy-message').textContent = 'Uma aba antiga gravou novas anotações. Feche essa aba e transfira o restante.';
      toast('Anotações antigas transferidas para este computador.');
    } catch (error) { $('legacy-message').textContent = 'As anotações antigas continuam preservadas neste navegador. ' + error.message; }
    finally { $('transfer-legacy').disabled = false; }
  }
  async function start() {
    if (starting) return; starting = true; setReadOnly(true);
    try { await sync.load(); await transferLegacy(); setReadOnly(false); }
    catch { /* The status callback displays the retry/sign-in controls. */ }
    finally { starting = false; }
  }
  $('retry-save').onclick = async () => { if (!sync.loaded) await start(); else if (await sync.retry()) toast('Salvo.'); };
  $('transfer-legacy').onclick = async () => { if (sync.dirty && !await sync.flush()) return; setReadOnly(true); await transferLegacy(); setReadOnly(false); };
  $('resolve-conflict').onclick = async () => {
    download(JSON.stringify({ ...state, exportedAt: new Date().toISOString(), app: 'Dia a dia' }, null, 2), `dia-a-dia-rascunho-${C.dateKey()}.json`, 'application/json');
    setReadOnly(true);
    try { await sync.reloadAfterBackup(); setReadOnly(false); toast('Rascunho baixado. Exibindo a versão salva.'); } catch { /* Keep the draft visible on failure. */ }
  };
  function refreshWhenIdle() { if (!readOnly && !document.querySelector('dialog[open]')) sync.refresh(); }
  window.addEventListener('beforeunload', e => { if (sync.dirty) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('online', () => { if (sync.dirty) sync.retry(); else if (!sync.loaded) start(); else refreshWhenIdle(); });
  window.addEventListener('focus', () => { updateToday(); refreshWhenIdle(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateToday(); refreshWhenIdle(); } else if (sync.dirty) sync.flush(); });
  setInterval(updateToday, 30000);
  setInterval(refreshWhenIdle, 15000);
  selectDate(today, true); updateToday(); renderTasks(); setReadOnly(true); start();
})();
