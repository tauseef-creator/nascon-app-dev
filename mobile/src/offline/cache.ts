// Read-through cache: online -> fetch and store; network failure -> last cached copy.
import { api } from '../api/client';
import { AppError } from '../api/errors';
import { getDb } from './db';
import { isOnlineNow } from './netState';

export type Cached<T> = { data: T; fromCache: boolean; updatedAt: string };

export async function readCache<T>(key: string): Promise<Cached<T> | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ json: string; updated_at: string }>(
    'SELECT json, updated_at FROM cache WHERE key = ?',
    key,
  );
  if (!row) return null;
  try {
    return { data: JSON.parse(row.json) as T, fromCache: true, updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

export async function writeCache(key: string, data: unknown): Promise<string> {
  const db = await getDb();
  const at = new Date().toISOString();
  await db.runAsync('INSERT OR REPLACE INTO cache (key, json, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(data), at);
  return at;
}

export async function cachedGet<T>(key: string, path: string): Promise<Cached<T>> {
  if (!isOnlineNow()) {
    const c = await readCache<T>(key);
    if (c) return c;
    throw new AppError('OFFLINE_NO_CACHE', 0, null, "You're offline and this screen hasn't been saved on this phone yet. Connect once to load it.");
  }
  try {
    const data = await api<T>(path);
    const updatedAt = await writeCache(key, data);
    return { data, fromCache: false, updatedAt };
  } catch (e) {
    if (e instanceof AppError && e.isNetwork) {
      const c = await readCache<T>(key);
      if (c) return c;
      throw new AppError(
        'OFFLINE_NO_CACHE',
        0,
        null,
        "We can't reach the server and this screen hasn't been saved on this phone yet. Check the connection or the server address in Settings.",
      );
    }
    throw e;
  }
}
