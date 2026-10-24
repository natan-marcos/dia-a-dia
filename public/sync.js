(function (root) {
  'use strict';
  function createSync({ onStatus = () => {}, onState = () => {}, fetcher = (...args) => fetch(...args), delay = 450 } = {}) {
    let revision = 0, loaded = false, baseline = '', queued = null, pending = null, running = null, timer;
    let problem = null, generation = 0, transferring = false;
    const status = (kind, message = '') => onStatus({ kind, message, dirty: !!(queued || pending), loaded });
    async function request(method = 'GET', body) {
      let response;
      try {
        response = await fetcher('/api/state', { method, credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
      } catch { throw Object.assign(new Error('O aplicativo local não respondeu. Seu texto continua nesta tela. Tente novamente antes de fechar.'), { status: 0 }); }
      let result; try { result = await response.json(); } catch { throw Object.assign(new Error('O aplicativo não confirmou o salvamento. Tente novamente.'), { status: response.status }); }
      if (!response.ok) throw Object.assign(new Error(result.error || 'Não foi possível acessar suas anotações.'), { status: response.status });
      return result;
    }
    function accept(result) {
      const state = root.DailyCore.validate(result.state);
      revision = result.revision; baseline = JSON.stringify(state); loaded = true; problem = null;
      onState(state); status('saved'); return state;
    }
    async function load() {
      generation++; loaded = false; status('loading');
      try { return accept(await request()); } catch (error) { problem = error; status(error.status === 401 ? 'auth' : 'error', error.message); throw error; }
    }
    function save(state) {
      if (!loaded || transferring) return false;
      const json = JSON.stringify(root.DailyCore.validate(state));
      if (!queued && !pending && json === baseline) return true;
      queued = json; generation++;
      if (!problem) { status('saving'); clearTimeout(timer); timer = setTimeout(() => flush(), delay); }
      return true;
    }
    function flush() {
      clearTimeout(timer);
      if (running) return running;
      if (problem || !loaded) return Promise.resolve(false);
      running = (async () => {
        while (queued || pending) {
          if (!pending) { pending = { baseRevision: revision, requestId: root.DailyCore.uid(), state: JSON.parse(queued) }; queued = null; }
          status('saving');
          try {
            const result = await request('PUT', pending);
            if (result.requestId !== pending.requestId || !Number.isSafeInteger(result.revision)) throw new Error('Confirmação de salvamento inválida. Tente novamente.');
            revision = result.revision; baseline = JSON.stringify(pending.state); pending = null;
            if (queued === baseline) queued = null;
          } catch (error) {
            // A definitive validation rejection did not commit. Let a corrected draft replace it.
            if ([400, 413, 415, 422].includes(error.status)) {
              if (!queued) queued = JSON.stringify(pending.state);
              pending = null;
            }
            problem = error; status(error.status === 409 ? 'conflict' : error.status === 401 ? 'auth' : 'error', error.message); return false;
          }
        }
        status('saved'); return true;
      })().finally(() => { clearTimeout(timer); running = null; });
      return running;
    }
    async function retry() { if (!loaded) return load().then(() => true); if (problem?.status === 409) return false; problem = null; return flush(); }
    async function refresh() {
      if (!loaded || queued || pending || running || problem || transferring) return;
      const before = generation;
      try { const result = await request(); if (generation !== before || queued || pending || running || problem || transferring) return; if (result.revision > revision) accept(result); }
      catch { /* A failed background read must never discard or disable a clean draft. */ }
    }
    async function migrate(state) {
      if (queued || pending || running) throw new Error('Espere as alterações terminarem de salvar.');
      transferring = true; generation++;
      try { return accept(await request('POST', { state: root.DailyCore.validate(state) })); }
      finally { transferring = false; generation++; }
    }
    async function reloadAfterBackup() {
      if (running) await running;
      queued = null; pending = null; problem = null; generation++;
      return load();
    }
    return { load, save, flush, retry, refresh, migrate, reloadAfterBackup, get dirty() { return !!(queued || pending); }, get loaded() { return loaded; } };
  }
  root.DailySync = { create: createSync };
})(globalThis);
