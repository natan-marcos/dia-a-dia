(function (root) {
  'use strict';
  const ITERATIONS = 600000;
  const MAX_IMAGES = 20;
  const encode = value => new TextEncoder().encode(value);
  const base64 = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(text); };
  const bytes = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));
  const context = purpose => encode('dia-a-dia.references.v1:' + purpose);
  async function derive(password, salt, iterations = ITERATIONS) {
    if (iterations !== ITERATIONS || bytes(salt).length !== 16) throw new Error('Configuração de proteção inválida.');
    const material = await crypto.subtle.importKey('raw', encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes(salt), iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function sealBytes(key, data, purpose) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: context(purpose) }, key, data));
    return { iv: base64(iv), data: cipher };
  }
  async function openBytes(key, data, iv, purpose) {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv), additionalData: context(purpose) }, key, data));
  }
  async function seal(key, value, purpose) {
    const encrypted = await sealBytes(key, encode(JSON.stringify(value)), purpose);
    return { iv: encrypted.iv, ciphertext: base64(encrypted.data) };
  }
  async function open(key, envelope, purpose) {
    return JSON.parse(new TextDecoder().decode(await openBytes(key, bytes(envelope.ciphertext), envelope.iv, purpose)));
  }
  async function hash(data) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function imagesOf(item) { return item.images !== undefined ? item.images : item.image ? [item.image] : []; }
  function validateItem(item) {
    if (!item || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 150 || !['note', 'password', 'code', 'config', 'image'].includes(item.kind)) throw new Error('Preencha o título e o tipo da referência.');
    for (const name of ['content', 'username', 'password', 'url', 'language']) if (item[name] !== undefined && typeof item[name] !== 'string') throw new Error('Referência inválida.');
    if (encode(JSON.stringify(item)).byteLength > 250000) throw new Error('Esta referência excede 250 KB de texto. Divida-a em mais de uma anotação.');
    const images = imagesOf(item);
    if (!Array.isArray(images) || images.length > MAX_IMAGES) throw new Error('Use até ' + MAX_IMAGES + ' imagens por referência.');
    for (const image of images) {
      if (!image || !/^[a-f0-9]{64}$/.test(image.id) || typeof image.iv !== 'string' || bytes(image.iv).length !== 12 || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(image.mime) || image.name !== undefined && (typeof image.name !== 'string' || image.name.length > 500)) throw new Error('Imagem inválida.');
    }
    return item;
  }
  root.ReferenceCrypto = { ITERATIONS, MAX_IMAGES, imagesOf, base64, bytes, derive, seal, open, sealBytes, openBytes, hash, validateItem, newSalt: () => base64(crypto.getRandomValues(new Uint8Array(16))) };
})(globalThis);

(function (root) {
  'use strict';
  const V = root.ReferenceCrypto;
  function create({ key, fetcher, decodeImage = async file => { const bitmap = await createImageBitmap(file); bitmap.close(); } }) {
    const entries = [];
    let disposed = false;
    function remove(entry) {
      const index = entries.indexOf(entry);
      if (index < 0) return;
      if (entry.url) URL.revokeObjectURL(entry.url);
      entries.splice(index, 1);
    }
    function close() { disposed = true; for (const entry of [...entries]) remove(entry); }
    function restore(metadata) {
      for (const entry of [...entries]) remove(entry);
      for (const meta of metadata) entries.push({ meta: { ...meta }, uploaded: true, blob: null, url: null });
    }
    async function attach(file) {
      if (disposed) return null;
      if (entries.length >= V.MAX_IMAGES) throw new Error('Use até ' + V.MAX_IMAGES + ' imagens por referência.');
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error('Escolha PNG, JPG, WEBP ou GIF de até 8 MB por imagem.');
      await decodeImage(file);
      const encrypted = await V.sealBytes(key, await file.arrayBuffer(), 'image');
      if (disposed) return null;
      const meta = { id: await V.hash(encrypted.data), iv: encrypted.iv, name: (file.name || 'imagem.png').slice(0, 500), mime: file.type, size: file.size };
      if (disposed) return null;
      const entry = { meta, encrypted: encrypted.data, blob: file, uploaded: false, url: null };
      entries.push(entry); return entry;
    }
    async function load(entry) {
      if (disposed || !entries.includes(entry)) return null;
      if (entry.url) return entry.url;
      if (entry.loading) return entry.loading;
      entry.loading = (async () => {
        if (!entry.blob) {
          const response = await fetcher('/api/reference-files/' + entry.meta.id);
          const encrypted = new Uint8Array(await response.arrayBuffer());
          if (await V.hash(encrypted) !== entry.meta.id) throw new Error('Não foi possível verificar a imagem.');
          const plain = await V.openBytes(key, encrypted, entry.meta.iv, 'image');
          if (disposed || !entries.includes(entry)) return null;
          entry.blob = new Blob([plain], { type: entry.meta.mime });
        }
        if (disposed || !entries.includes(entry)) return null;
        entry.url = URL.createObjectURL(entry.blob); return entry.url;
      })();
      try { return await entry.loading; } finally { entry.loading = null; }
    }
    async function uploadAll() {
      for (const entry of entries) if (!entry.uploaded) {
        await fetcher('/api/reference-files/' + entry.meta.id, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: entry.encrypted });
        entry.uploaded = true;
      }
    }
    return { entries, restore, attach, remove, close, load, uploadAll, metadata: () => entries.map(entry => ({ ...entry.meta })) };
  }
  root.ReferenceImages = { create };
})(globalThis);
