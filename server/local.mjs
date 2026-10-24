import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { openDatabase, localImages } from './local-storage.mjs';
import { handleState } from './state-store.mjs';
import { handleReferences } from './references-store.mjs';

export const DEFAULT_PORT = 43127;
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']], ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ...['app.js', 'core.js', 'sync.js', 'references.js', 'reference-crypto.js', 'presence.js'].map(name => ['/' + name, [name, 'text/javascript; charset=utf-8']]),
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']], ['/icon.svg', ['icon.svg', 'image/svg+xml']]
]);
export async function startLocal({ dataDir = join(process.env.LOCALAPPDATA || homedir(), 'DiaADia'), port = DEFAULT_PORT, presence = {} } = {}) {
  const db = await openDatabase(dataDir), images = localImages(dataDir), stopToken = crypto.randomUUID();
  const timing = { startupMs: 30000, releaseMs: 8000, staleMs: 90000, requestGraceMs: 30000, checkMs: 1000, ...presence };
  const tabs = new Map();
  let emptySince = Date.now(), lastDataRequest = 0;
  let origin, closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    clearInterval(watch);
    await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
    db.close();
  }
  const server = createServer(async (incoming, outgoing) => {
    const headers = {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    };
    try {
      if (incoming.headers.host !== new URL(origin).host) { outgoing.writeHead(403, headers); outgoing.end('Host inválido'); return; }
      const url = new URL(incoming.url, origin);
      if (url.origin !== origin) { outgoing.writeHead(403, headers); outgoing.end(); return; }
      const privateRoute = url.pathname.startsWith('/api/');
      if (privateRoute && (incoming.headers['sec-fetch-site'] === 'cross-site' || incoming.headers.origin && incoming.headers.origin !== origin)) {
        outgoing.writeHead(403, headers); outgoing.end('Origem inválida'); return;
      }
      if (['/api/local/heartbeat', '/api/local/release'].includes(url.pathname) && incoming.method === 'POST') {
        incoming.resume();
        const tab = url.searchParams.get('id');
        if (!tab || !/^[a-f0-9-]{36}$/.test(tab)) { outgoing.writeHead(400, headers); outgoing.end(); return; }
        if (url.pathname.endsWith('/heartbeat')) tabs.set(tab, Date.now());
        else tabs.delete(tab);
        if (!tabs.size) emptySince = Date.now();
        outgoing.writeHead(204, headers); outgoing.end(); return;
      }
      if (url.pathname === '/api/local/health' && incoming.method === 'GET') {
        outgoing.writeHead(200, { ...headers, 'Content-Type': 'application/json' }); outgoing.end(JSON.stringify({ app: 'dia-a-dia-local', version: 1 })); return;
      }
      if (url.pathname === '/api/local/stop' && incoming.method === 'POST') {
        if (incoming.headers['x-local-control'] !== stopToken) { outgoing.writeHead(403, headers); outgoing.end(); return; }
        outgoing.writeHead(200, headers); outgoing.end('Encerrado'); setImmediate(() => close()); return;
      }
      let response;
      if (url.pathname === '/api/state' || url.pathname === '/api/references' || /^\/api\/reference-files\/[a-f0-9]{64}$/.test(url.pathname)) {
        lastDataRequest = Date.now();
        const request = new Request(url, { method: incoming.method, headers: incoming.headers, ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}) });
        response = url.pathname === '/api/state' ? await handleState(request, db, 'local') : await handleReferences(request, db, images, 'local', url.pathname.startsWith('/api/reference-files/') ? url.pathname.split('/').at(-1) : null);
      } else if (assets.has(url.pathname) && ['GET', 'HEAD'].includes(incoming.method)) {
        const [name, type] = assets.get(url.pathname);
        response = new Response(await readFile(new URL('../public/' + name, import.meta.url)), { headers: { 'Content-Type': type } });
      } else response = new Response('Não encontrado', { status: 404 });
      outgoing.writeHead(response.status, { ...headers, ...Object.fromEntries(response.headers) });
      outgoing.end(incoming.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error('Falha local:', error.name);
      if (!outgoing.headersSent) outgoing.writeHead(500, { ...headers, 'Content-Type': 'application/json' });
      outgoing.end(JSON.stringify({ error: 'Não foi possível concluir. Tente novamente.' }));
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  const watch = setInterval(() => {
    if (closed) return;
    const now = Date.now();
    for (const [tab, lastSeen] of tabs) if (now - lastSeen > timing.staleMs) tabs.delete(tab);
    if (tabs.size) { emptySince = now; return; }
    const grace = now - emptySince >= (emptySince === startedAt ? timing.startupMs : timing.releaseMs);
    if (grace && now - lastDataRequest >= timing.requestGraceMs) void close();
  }, timing.checkMs);
  const startedAt = emptySince;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }).catch(error => { db.close(); throw error; });
  origin = 'http://127.0.0.1:' + server.address().port;
  await writeFile(join(dataDir, 'controle-local.txt'), stopToken, { mode: 0o600 });
  return { origin, close, dataDir };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await startLocal({ dataDir: process.env.DIA_A_DIA_DATA_DIR, port: Number(process.env.DIA_A_DIA_PORT || DEFAULT_PORT) });
  console.log('Dia a dia: ' + app.origin);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
