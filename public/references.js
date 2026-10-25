(() => {
  'use strict';
  const $ = id => document.getElementById(id), V = window.ReferenceCrypto;
  const names = { note: 'Anotação', password: 'Senha', code: 'Código', config: 'Configuração', image: 'Imagem' };
  let key = null, config = null, items = [], current = null, pending = null, imageData = null, imageUrl = null;
  let dirty = false, busy = false, loading = false, generation = 0, lastActivity = Date.now();
  function alert(message = '') { $('ref-alert').textContent = message; $('ref-alert').hidden = !message; }
  function markDirty() { dirty = true; $('ref-save-status').textContent = 'Não salvo'; lastActivity = Date.now(); }
  async function api(path, options = {}) {
    let response;
    try { response = await fetch(path, { ...options, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(30000) }); }
    catch { throw new Error('Sem conexão. Suas alterações continuam nesta tela. Tente salvar novamente.'); }
    if (!response.ok) { let error; try { error = (await response.json()).error; } catch {} throw Object.assign(new Error(error || 'Não foi possível concluir. Tente novamente.'), { status: response.status }); }
    return response;
  }
  async function json(method, body, suffix = '') {
    const response = await api('/api/references' + suffix, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    return response.json();
  }
  function switchTab(refs) {
    $('daily-view').hidden = refs; $('references-view').hidden = !refs;
    for (const id of ['tab-daily', 'tab-references']) { const selected = id === (refs ? 'tab-references' : 'tab-daily'); $(id).setAttribute('aria-selected', String(selected)); $(id).tabIndex = selected ? 0 : -1; }
    if (refs && !key && !loading) loadConfig();
    lastActivity = Date.now();
  }
  $('tab-daily').onclick = () => switchTab(false);
  $('tab-references').onclick = () => switchTab(true);
  $('brand-home').addEventListener('click', () => switchTab(false));
  document.querySelector('.view-tabs').addEventListener('keydown', e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const refs = e.key === 'End' || e.key !== 'Home' && e.target.id === 'tab-daily'; switchTab(refs); $(refs ? 'tab-references' : 'tab-daily').focus(); } });
  async function loadConfig() {
    loading = true; alert(); $('ref-load-retry').hidden = true; $('ref-unlock-form').hidden = true; $('ref-unlock-title').textContent = 'Carregando…';
    try {
      config = await json('GET');
      $('ref-unlock-title').textContent = config.exists ? 'Desbloquear referências' : 'Proteger referências';
      $('ref-unlock-description').textContent = config.exists ? 'Digite sua senha mestra.' : 'Crie uma senha mestra para proteger o conteúdo desta aba.';
      $('ref-confirm-group').hidden = config.exists; $('ref-master-confirm').required = !config.exists;
      $('ref-master').minLength = config.exists ? 1 : 8; $('ref-master').autocomplete = config.exists ? 'current-password' : 'new-password';
      $('ref-unlock-submit').textContent = config.exists ? 'Desbloquear' : 'Criar e abrir'; $('ref-unlock-form').hidden = false;
    } catch (error) { alert(error.message); $('ref-unlock-title').textContent = 'Referências indisponíveis'; $('ref-load-retry').hidden = false; }
    finally { loading = false; }
  }
  $('ref-load-retry').onclick = loadConfig;
  async function decryptList(source, candidateKey) {
    return Promise.all(source.map(async item => ({ id: item.id, revision: item.revision, ...await V.open(candidateKey, item.envelope, 'summary:' + item.id) })));
  }
  $('ref-unlock-form').onsubmit = async e => {
    e.preventDefault(); if (busy || !config) return;
    const password = $('ref-master').value;
    if (!config.exists && (password.length < 8 || password !== $('ref-master-confirm').value)) { alert('Use pelo menos 8 caracteres e confirme a mesma senha.'); return; }
    busy = true; $('ref-unlock-submit').disabled = true; alert();
    try {
      const salt = config.exists ? config.salt : V.newSalt();
      const candidateKey = await V.derive(password, salt, V.ITERATIONS);
      if (config.exists) {
        let verifier; try { verifier = await V.open(candidateKey, config.verifier, 'verifier'); } catch { throw new Error('Senha mestra incorreta ou conteúdo indisponível.'); }
        if (verifier.marker !== 'daily-references-v1') throw new Error('Conteúdo de referências inválido.');
      } else {
        const verifier = await V.seal(candidateKey, { marker: 'daily-references-v1' }, 'verifier');
        await json('POST', { salt, iterations: V.ITERATIONS, verifier }); config = await json('GET');
      }
      const decoded = await decryptList(config.items || [], candidateKey);
      key = candidateKey; items = decoded; $('ref-master').value = ''; $('ref-master-confirm').value = '';
      $('ref-unlock-panel').hidden = true; $('ref-workspace').hidden = false; $('ref-lock').hidden = false; renderList(); lastActivity = Date.now();
    } catch (error) { alert(error.message); $('ref-load-retry').hidden = false; }
    finally { busy = false; $('ref-unlock-submit').disabled = false; }
  };
  function revokeImage() { if (imageUrl) URL.revokeObjectURL(imageUrl); imageUrl = null; $('ref-image-preview').removeAttribute('src'); $('ref-image-preview').hidden = true; }
  function lock() {
    if (busy) return;
    if (dirty) { alert('Salve suas alterações antes de bloquear.'); return; }
    generation++; key = null; items = []; current = null; pending = null; imageData = null; config = null; revokeImage();
    $('ref-editor').reset(); $('ref-editor').hidden = true; $('ref-list').replaceChildren(); $('ref-search').value = ''; $('ref-empty').hidden = false;
    $('ref-workspace').hidden = true; $('ref-lock').hidden = true; $('ref-unlock-panel').hidden = false; alert(); loadConfig();
  }
  $('ref-lock').onclick = lock;
  function renderList() {
    const list = $('ref-list'), query = $('ref-search').value.trim().toLocaleLowerCase('pt-BR'), filter = $('ref-filter').value;
    list.replaceChildren();
    const visible = items.filter(item => (filter === 'archived' ? item.archived : !item.archived) && (['all', 'archived'].includes(filter) || item.kind === filter) && item.title.toLocaleLowerCase('pt-BR').includes(query));
    for (const item of visible) {
      const button = document.createElement('button'); button.className = 'ref-list-item'; button.type = 'button'; button.classList.toggle('selected', current?.id === item.id);
      const title = document.createElement('strong'); title.textContent = item.title;
      const subtitle = document.createElement('span'); subtitle.textContent = names[item.kind] || 'Referência';
      button.append(title, subtitle); button.onclick = () => selectItem(item); list.append(button);
    }
    if (!visible.length) { const empty = document.createElement('p'); empty.className = 'ref-list-empty'; empty.textContent = query ? 'Nenhum resultado' : 'Nenhuma referência'; list.append(empty); }
  }
  $('ref-search').oninput = renderList; $('ref-filter').onchange = renderList;
  function canLeave() { return !busy && (!dirty || confirm('Há alterações não salvas. Descartar essas alterações?')); }
  function blank(kind = 'note') { return { title: '', kind, content: '', username: '', password: '', url: '', language: kind === 'config' ? 'xml' : 'text', image: null, archived: false }; }
  function fields() {
    return V.validateItem({ title: $('ref-title').value.trim(), kind: $('ref-kind').value, content: $('ref-content').value, username: $('ref-username').value, password: $('ref-password').value, url: $('ref-url').value, language: $('ref-language').value, image: imageData ? imageData.meta : null, archived: current?.data.archived || false });
  }
  function changeKind() {
    const kind = $('ref-kind').value;
    $('ref-credentials').hidden = kind !== 'password'; $('ref-code-tools').hidden = !['code', 'config'].includes(kind); $('ref-image-tools').hidden = kind !== 'image';
    $('ref-content').classList.toggle('code-editor', ['code', 'config'].includes(kind)); $('ref-content').spellcheck = !['code', 'config'].includes(kind);
    $('ref-content-label').textContent = ({ code: 'Código', config: 'Configuração', image: 'Legenda / anotações' })[kind] || 'Anotações';
  }
  function fill(data) {
    $('ref-editor').hidden = false; $('ref-empty').hidden = true;
    for (const name of ['title', 'kind', 'content', 'username', 'password', 'url', 'language']) $('ref-' + name).value = data[name] || (name === 'language' ? 'text' : '');
    $('ref-password').type = 'password'; $('ref-show-password').textContent = 'Mostrar'; $('ref-show-password').setAttribute('aria-pressed', 'false');
    $('ref-archive').hidden = !current?.revision; $('ref-archive').textContent = data.archived ? 'Restaurar' : 'Arquivar';
    $('ref-save-copy').hidden = true; $('ref-save-status').textContent = current?.revision ? 'Salvo' : 'Nova referência'; changeKind();
    $('ref-image-name').textContent = data.image?.name || ''; $('ref-download-image').hidden = !data.image;
  }
  $('ref-new').onclick = () => {
    if (!key || !canLeave()) return;
    generation++; pending = null; dirty = false; imageData = null; revokeImage(); alert();
    current = { id: crypto.randomUUID(), revision: 0, data: blank() }; fill(current.data); renderList(); $('ref-title').focus();
  };
  async function selectItem(item) {
    if (!canLeave()) return;
    const operation = ++generation; busy = true; $('ref-fields').disabled = true; alert();
    try {
      const stored = await json('GET', undefined, '?id=' + encodeURIComponent(item.id));
      const data = V.validateItem(await V.open(key, stored.envelope, 'item:' + item.id));
      if (operation !== generation || !key) return;
      current = { id: item.id, revision: stored.revision, data }; pending = null; dirty = false; imageData = data.image ? { meta: data.image, uploaded: true } : null;
      revokeImage(); fill(data); renderList();
      $('ref-image-name').textContent = data.image?.name || ''; $('ref-download-image').hidden = !data.image;
      if (data.image && data.kind === 'image') await loadImage(operation);
    } catch (error) { alert(error.message); }
    finally { busy = false; $('ref-fields').disabled = false; }
  }
  async function loadImage(operation = generation) {
    if (!imageData) return;
    const meta = imageData.meta;
    const encrypted = new Uint8Array(await (await api('/api/reference-files/' + meta.id)).arrayBuffer());
    if (await V.hash(encrypted) !== meta.id) throw new Error('Não foi possível verificar a imagem.');
    const plain = await V.openBytes(key, encrypted, meta.iv, 'image');
    if (operation !== generation || !key) return;
    imageData.blob = new Blob([plain], { type: meta.mime }); showImage();
  }
  function showImage() {
    revokeImage(); if (!imageData?.blob) return;
    imageUrl = URL.createObjectURL(imageData.blob); $('ref-image-preview').src = imageUrl; $('ref-image-preview').hidden = false;
    $('ref-image-name').textContent = imageData.meta.name; $('ref-download-image').hidden = false;
  }
  async function attachImage(file) {
    if (!file || busy || !key || !current) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 8 * 1024 * 1024) { alert('Escolha PNG, JPG, WEBP ou GIF de até 8 MB.'); return; }
    busy = true; $('ref-fields').disabled = true; alert();
    try {
      const bitmap = await createImageBitmap(file); bitmap.close();
      const encrypted = await V.sealBytes(key, await file.arrayBuffer(), 'image');
      imageData = { meta: { id: await V.hash(encrypted.data), iv: encrypted.iv, name: file.name || 'imagem.png', mime: file.type, size: file.size }, encrypted: encrypted.data, blob: file, uploaded: false };
      if (!$('ref-title').value) $('ref-title').value = imageData.meta.name;
      $('ref-kind').value = 'image'; changeKind(); showImage(); markDirty();
    } catch { alert('Não foi possível ler essa imagem.'); }
    finally { busy = false; $('ref-fields').disabled = false; }
  }
  $('ref-image-choose').onclick = () => { $('ref-image-file').value = ''; $('ref-image-file').click(); };
  $('ref-image-file').onchange = e => attachImage(e.target.files[0]);
  $('references-view').addEventListener('paste', e => {
    if (!key || !current || busy) return;
    const image = Array.from(e.clipboardData?.items || []).find(item => item.type.startsWith('image/'));
    if (image) { e.preventDefault(); attachImage(image.getAsFile()); }
  });
  $('ref-image-choose').ondragover = e => e.preventDefault();
  $('ref-image-choose').ondrop = e => { e.preventDefault(); attachImage(e.dataTransfer.files[0]); };
  $('ref-download-image').onclick = async () => {
    try { if (!imageData?.blob) await loadImage(); if (!imageUrl) return; const a = document.createElement('a'); a.href = imageUrl; a.download = imageData.meta.name; a.click(); }
    catch (error) { alert(error.message); }
  };
  $('ref-import-code').onclick = () => { $('ref-code-file').value = ''; $('ref-code-file').click(); };
  $('ref-code-file').onchange = async e => {
    const file = e.target.files[0]; if (!file || busy || !key || !current) return;
    if (file.size > 230000) { alert('O arquivo de texto deve ter até 230 KB.'); return; }
    busy = true; $('ref-fields').disabled = true;
    try {
      const buffer = await file.arrayBuffer(), bytes = new Uint8Array(buffer); let encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
      let text = new TextDecoder(encoding).decode(buffer); if (encoding === 'utf-8' && text.includes('\ufffd')) text = new TextDecoder('windows-1252').decode(buffer);
      if ($('ref-content').value && !confirm('Substituir o texto atual pelo conteúdo do arquivo?')) return;
      $('ref-content').value = text; if (!$('ref-title').value) $('ref-title').value = file.name;
      const ext = file.name.split('.').pop().toLowerCase(); const format = ext === 'config' ? 'xml' : ext === 'yml' ? 'yaml' : ext;
      if (Array.from($('ref-language').options).some(option => option.value === format)) $('ref-language').value = format;
      markDirty();
    } catch { alert('Não foi possível ler o arquivo.'); }
    finally { busy = false; $('ref-fields').disabled = false; }
  };
  $('ref-editor').addEventListener('input', markDirty);
  $('ref-kind').onchange = () => { changeKind(); markDirty(); };
  $('ref-content').addEventListener('keydown', e => {
    if (e.key === 'Tab' && !e.shiftKey && ['code', 'config'].includes($('ref-kind').value)) { e.preventDefault(); const input = e.target; input.setRangeText('  ', input.selectionStart, input.selectionEnd, 'end'); markDirty(); }
  });
  $('ref-show-password').onclick = () => { const visible = $('ref-password').type === 'password'; $('ref-password').type = visible ? 'text' : 'password'; $('ref-show-password').textContent = visible ? 'Ocultar' : 'Mostrar'; $('ref-show-password').setAttribute('aria-pressed', String(visible)); };
  async function copy(value) { try { await navigator.clipboard.writeText(value); $('ref-save-status').textContent = 'Copiado'; } catch { alert('Não foi possível copiar. Selecione o texto e use Ctrl+C.'); } }
  $('ref-copy-password').onclick = () => copy($('ref-password').value);
  $('ref-copy-content').onclick = () => copy($('ref-content').value);
  async function save(asCopy = false) {
    if (busy || !key || !current) return false;
    let data; try { data = fields(); } catch (error) { alert(error.message); return false; }
    if (data.kind === 'image' && !data.image) { alert('Adicione uma imagem.'); return false; }
    busy = true; $('ref-fields').disabled = true; $('ref-save').disabled = true; alert(); $('ref-save-status').textContent = 'Salvando…';
    try {
      if (asCopy) { current = { id: crypto.randomUUID(), revision: 0, data }; pending = null; }
      if (imageData && !imageData.uploaded) {
        await api('/api/reference-files/' + imageData.meta.id, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: imageData.encrypted }); imageData.uploaded = true;
      }
      // Reconcile an uncertain earlier attempt before constructing a new encrypted request.
      if (pending) { const accepted = await json('PUT', pending.body); current.revision = accepted.revision; pending = null; }
      const summary = { title: data.title, kind: data.kind, archived: data.archived, updatedAt: new Date().toISOString() };
      const body = { id: current.id, baseRevision: current.revision, requestId: crypto.randomUUID(), summary: await V.seal(key, summary, 'summary:' + current.id), envelope: await V.seal(key, data, 'item:' + current.id) };
      pending = { body }; const accepted = await json('PUT', body); pending = null;
      current.revision = accepted.revision; current.data = data; dirty = false;
      const item = { id: current.id, revision: current.revision, ...summary }, index = items.findIndex(entry => entry.id === item.id);
      if (index >= 0) items.splice(index, 1); items.unshift(item);
      $('ref-save-status').textContent = 'Salvo'; $('ref-archive').hidden = false; $('ref-archive').textContent = data.archived ? 'Restaurar' : 'Arquivar'; $('ref-save-copy').hidden = true; renderList(); return true;
    } catch (error) {
      dirty = true; $('ref-save-status').textContent = 'Não salvo'; alert(error.message);
      if (error.status === 409) $('ref-save-copy').hidden = false;
      if ([400, 413, 415].includes(error.status)) pending = null;
      return false;
    } finally { busy = false; $('ref-fields').disabled = false; $('ref-save').disabled = false; }
  }
  $('ref-editor').onsubmit = e => { e.preventDefault(); save(); };
  $('ref-save-copy').onclick = () => save(true);
  $('ref-archive').onclick = async () => { if (busy || !current) return; current.data.archived = !current.data.archived; markDirty(); await save(); };
  document.addEventListener('keydown', e => { if (!$('references-view').hidden && (e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (key && current) save(); } });
  window.addEventListener('beforeunload', e => { if (dirty || busy) { e.preventDefault(); e.returnValue = ''; } });
  ['pointerdown', 'keydown'].forEach(event => $('references-view').addEventListener(event, () => { lastActivity = Date.now(); }));
  setInterval(() => { if (key && !dirty && !busy && Date.now() - lastActivity > 10 * 60 * 1000) lock(); }, 30000);
})();
