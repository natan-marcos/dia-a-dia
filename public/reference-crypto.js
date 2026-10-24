(function (root) {
  'use strict';
  const ITERATIONS = 600000;
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
  function validateItem(item) {
    if (!item || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 150 || !['note', 'password', 'code', 'config', 'image'].includes(item.kind)) throw new Error('Preencha o título e o tipo da referência.');
    for (const name of ['content', 'username', 'password', 'url', 'language']) if (item[name] !== undefined && typeof item[name] !== 'string') throw new Error('Referência inválida.');
    if (encode(JSON.stringify(item)).byteLength > 250000) throw new Error('Esta referência excede 250 KB de texto. Divida-a em mais de uma anotação.');
    if (item.image && (!/^[a-f0-9]{64}$/.test(item.image.id) || bytes(item.image.iv).length !== 12 || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(item.image.mime))) throw new Error('Imagem inválida.');
    return item;
  }
  root.ReferenceCrypto = { ITERATIONS, base64, bytes, derive, seal, open, sealBytes, openBytes, hash, validateItem, newSalt: () => base64(crypto.getRandomValues(new Uint8Array(16))) };
})(globalThis);
