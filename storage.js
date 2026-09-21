import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

/**
 * Small durable state-store adapter used by the single Railway writer.
 *
 * The application state is deliberately kept behind this adapter so the
 * existing API/domain code can migrate from the old JSON file without losing
 * data. SQLite provides atomic commits, WAL recovery and a persistent volume
 * friendly file. Google Sheet remains an asynchronous mirror/backup; it is
 * not used as the live transaction store.
 */
export function createStateStore({ backend = 'sqlite', sqliteFile, jsonFile }) {
  const selected = String(backend || 'sqlite').trim().toLowerCase();
  if (selected === 'json') return createJsonStore(jsonFile);
  return createSqliteStore(sqliteFile, jsonFile);
}

function createSqliteStore(sqliteFile, legacyJsonFile) {
  if (!sqliteFile) throw new Error('SQLite file path is missing.');
  fs.mkdirSync(path.dirname(sqliteFile), { recursive: true });
  const connection = new Database(sqliteFile);
  connection.pragma('journal_mode = WAL');
  connection.pragma('synchronous = FULL');
  connection.pragma('foreign_keys = ON');
  connection.pragma('busy_timeout = 5000');
  connection.exec(`
    CREATE TABLE IF NOT EXISTS instant_state (
      state_id INTEGER PRIMARY KEY CHECK (state_id = 1),
      schema_version INTEGER NOT NULL DEFAULT 1,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const readState = connection.prepare('SELECT state_json, schema_version, updated_at FROM instant_state WHERE state_id = 1');
  const writeState = connection.prepare(`
    INSERT INTO instant_state (state_id, schema_version, state_json, updated_at)
    VALUES (1, 1, @stateJson, @updatedAt)
    ON CONFLICT(state_id) DO UPDATE SET
      schema_version = excluded.schema_version,
      state_json = excluded.state_json,
      updated_at = excluded.updated_at
  `);
  const commitState = connection.transaction((stateJson, updatedAt) => {
    writeState.run({ stateJson, updatedAt });
  });

  let meta = { backend: 'sqlite', file: sqliteFile, source: 'empty', updatedAt: '' };

  function load() {
    const row = readState.get();
    if (row) {
      let parsed;
      try {
        parsed = JSON.parse(row.state_json);
      } catch (error) {
        throw new Error(`SQLite state is invalid JSON: ${error.message}`);
      }
      meta = { backend: 'sqlite', file: sqliteFile, source: 'sqlite', updatedAt: String(row.updated_at || '') };
      return { state: parsed, existed: true, source: 'sqlite', updatedAt: meta.updatedAt };
    }

    // One-time migration from the release-v8 JSON store. The original file is
    // left untouched so it remains an emergency fallback until the operator
    // removes it after confirming the SQLite deployment.
    if (legacyJsonFile && fs.existsSync(legacyJsonFile)) {
      const raw = fs.readFileSync(legacyJsonFile, 'utf8');
      if (raw.trim()) {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (error) {
          throw new Error(`Legacy JSON store is invalid: ${error.message}`);
        }
        save(parsed);
        meta = { backend: 'sqlite', file: sqliteFile, source: 'legacy-json-migrated', updatedAt: new Date().toISOString() };
        return { state: parsed, existed: true, source: 'legacy-json-migrated', updatedAt: meta.updatedAt };
      }
    }

    meta = { backend: 'sqlite', file: sqliteFile, source: 'empty', updatedAt: '' };
    return { state: null, existed: false, source: 'empty', updatedAt: '' };
  }

  function save(state) {
    const stateJson = JSON.stringify(state);
    const updatedAt = new Date().toISOString();
    commitState(stateJson, updatedAt);
    meta = { backend: 'sqlite', file: sqliteFile, source: 'sqlite', updatedAt };
  }

  function close() {
    if (connection.open) connection.close();
  }

  function describe() {
    return { ...meta, ready: connection.open === true };
  }

  return { backend: 'sqlite', load, save, close, describe };
}

function createJsonStore(jsonFile) {
  if (!jsonFile) throw new Error('JSON file path is missing.');
  fs.mkdirSync(path.dirname(jsonFile), { recursive: true });
  let meta = { backend: 'json', file: jsonFile, source: 'empty', updatedAt: '' };

  function load() {
    try {
      const raw = fs.readFileSync(jsonFile, 'utf8');
      const parsed = JSON.parse(raw);
      meta = { backend: 'json', file: jsonFile, source: 'json', updatedAt: new Date().toISOString() };
      return { state: parsed, existed: true, source: 'json', updatedAt: meta.updatedAt };
    } catch (error) {
      if (error.code === 'ENOENT') {
        meta = { backend: 'json', file: jsonFile, source: 'empty', updatedAt: '' };
        return { state: null, existed: false, source: 'empty', updatedAt: '' };
      }
      throw error;
    }
  }

  function save(state) {
    const content = JSON.stringify(state, null, 2);
    const temp = `${jsonFile}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(temp, content, 'utf8');
    fs.renameSync(temp, jsonFile);
    const updatedAt = new Date().toISOString();
    meta = { backend: 'json', file: jsonFile, source: 'json', updatedAt };
  }

  function close() {}
  function describe() { return { ...meta, ready: true }; }

  return { backend: 'json', load, save, close, describe };
}
