// Local SQLite database: read cache, offline action queue, sync results, meta.
import * as SQLite from 'expo-sqlite';
import { randomUUID } from 'expo-crypto';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('nascon.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS queue (
          action_id TEXT PRIMARY KEY NOT NULL,
          type TEXT NOT NULL,
          queued_at TEXT NOT NULL,
          base_version INTEGER NOT NULL,
          payload TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          error TEXT
        );
        CREATE TABLE IF NOT EXISTS sync_results (
          action_id TEXT NOT NULL,
          status TEXT NOT NULL,
          error_code TEXT,
          message TEXT,
          at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT);
      `);
      return db;
    })();
  }
  return dbPromise;
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string | null }>('SELECT value FROM meta WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string | null): Promise<void> {
  const db = await getDb();
  if (value === null) await db.runAsync('DELETE FROM meta WHERE key = ?', key);
  else await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value);
}

let deviceIdCache: string | null = null;

/** Stable per-install device id used for /audit/v1/offline-sync. */
export async function getDeviceId(): Promise<string> {
  if (deviceIdCache) return deviceIdCache;
  let id = await getMeta('device_id');
  if (!id) {
    id = 'dev-' + randomUUID();
    await setMeta('device_id', id);
  }
  deviceIdCache = id;
  return id;
}
