import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';

class Statement {
  constructor(sqlite, sql, values = []) { this.sqlite = sqlite; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.sqlite, this.sql, values); }
  execute() {
    const statement = this.sqlite.prepare(this.sql);
    if (statement.columns().length) return { success: true, results: statement.all(...this.values), meta: {} };
    const result = statement.run(...this.values);
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }
  async all() { return this.execute(); }
  async run() { return this.execute(); }
  async first(column) { const row = this.execute().results[0]; return row ? column === undefined ? row : row[column] : null; }
}

export async function openDatabase(dataDir) {
  await mkdir(dataDir, { recursive: true });
  const sqlite = new DatabaseSync(join(dataDir, 'dia-a-dia.sqlite'));
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
  sqlite.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
  for (const name of ['0000_sweet_nuke.sql', '0001_pink_speedball.sql']) {
    if (sqlite.prepare('SELECT name FROM local_migrations WHERE name=?').get(name)) continue;
    const sql = await readFile(new URL('../drizzle/' + name, import.meta.url), 'utf8');
    sqlite.exec('BEGIN IMMEDIATE');
    try { sqlite.exec(sql); sqlite.prepare('INSERT INTO local_migrations (name) VALUES (?)').run(name); sqlite.exec('COMMIT'); }
    catch (error) { sqlite.exec('ROLLBACK'); sqlite.close(); throw error; }
  }
  return {
    prepare: sql => new Statement(sqlite, sql),
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const results = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
    close() { sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)'); sqlite.close(); }
  };
}

export function localImages(dataDir) {
  function path(key) {
    if (!/^references\/[a-f0-9]{64}\/[a-f0-9]{64}$/.test(key)) throw new Error('Identificador inválido');
    return join(dataDir, 'imagens', ...key.split('/'));
  }
  return {
    async get(key) { try { return { body: await readFile(path(key)) }; } catch (error) { if (error.code === 'ENOENT') return null; throw error; } },
    async put(key, bytes) {
      const target = path(key), temp = target + '.' + crypto.randomUUID() + '.tmp';
      await mkdir(dirname(target), { recursive: true });
      try { await writeFile(temp, bytes, { flag: 'wx' }); await rename(temp, target); }
      finally { await rm(temp, { force: true }); }
    }
  };
}
