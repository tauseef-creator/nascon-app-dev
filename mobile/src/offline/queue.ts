// Persistent offline action queue in the exact spec 5.14 format, synced through
// POST /audit/v1/offline-sync.
import { randomUUID } from 'expo-crypto';
import { api } from '../api/client';
import { AppError, messageFor } from '../api/errors';
import { getDb, getDeviceId, getMeta, setMeta } from './db';

export type ActionType = 'score_event' | 'roster_transfer';

/** Exactly the spec 5.14 action shape. */
export type OfflineAction = {
  action_id: string;
  type: ActionType;
  queued_at: string;
  base_version: number;
  payload: any;
};

export type QueuedAction = OfflineAction & { status: string; error: string | null; label: string };

export type SyncResultRow = {
  action_id: string;
  status: 'applied' | 'rejected' | 'duplicate' | string;
  error_code: string | null;
  message: string;
  at: string;
  label: string;
};

/** UTC timestamp without milliseconds: YYYY-MM-DDTHH:MM:SSZ */
export function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribeQueue(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function emit() {
  listeners.forEach((fn) => fn());
}

export async function enqueueAction(
  type: ActionType,
  payload: any,
  baseVersion: number,
  label: string,
): Promise<OfflineAction> {
  const db = await getDb();
  const action: OfflineAction = {
    action_id: randomUUID(),
    type,
    queued_at: utcNow(),
    base_version: Math.max(0, Math.floor(baseVersion || 0)),
    payload,
  };
  await db.runAsync(
    "INSERT INTO queue (action_id, type, queued_at, base_version, payload, status, error) VALUES (?, ?, ?, ?, ?, 'pending', NULL)",
    action.action_id,
    action.type,
    action.queued_at,
    action.base_version,
    JSON.stringify(action.payload),
  );
  await setMeta('label:' + action.action_id, label);
  emit();
  return action;
}

export async function listQueue(): Promise<QueuedAction[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    action_id: string;
    type: ActionType;
    queued_at: string;
    base_version: number;
    payload: string;
    status: string;
    error: string | null;
  }>('SELECT * FROM queue ORDER BY queued_at ASC, rowid ASC');
  const out: QueuedAction[] = [];
  for (const r of rows) {
    out.push({
      action_id: r.action_id,
      type: r.type,
      queued_at: r.queued_at,
      base_version: r.base_version,
      payload: JSON.parse(r.payload),
      status: r.status,
      error: r.error,
      label: (await getMeta('label:' + r.action_id)) ?? r.type,
    });
  }
  return out;
}

export async function pendingCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM queue');
  return row?.n ?? 0;
}

export async function removeQueued(actionId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM queue WHERE action_id = ?', actionId);
  await setMeta('label:' + actionId, null);
  emit();
}

export async function listResults(limit = 50): Promise<SyncResultRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Omit<SyncResultRow, 'label'>>(
    'SELECT action_id, status, error_code, message, at FROM sync_results ORDER BY rowid DESC LIMIT ?',
    limit,
  );
  const out: SyncResultRow[] = [];
  for (const r of rows) out.push({ ...r, label: (await getMeta('rlabel:' + r.action_id)) ?? 'Action' });
  return out;
}

export async function clearResults(): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM sync_results');
  emit();
}

function resultMessage(r: { status: string; resolution?: string; error_code?: string | null }): string {
  if (r.status === 'applied') {
    return r.resolution === 'rebased_append'
      ? 'Saved. Other changes had been made on the server meanwhile, and yours was added after them.'
      : 'Saved on the server.';
  }
  if (r.status === 'duplicate') return 'Already on the server, so nothing changed.';
  return 'Not applied: ' + messageFor(r.error_code ?? null) + ' The server kept its version.';
}

export type SyncOutcome = { applied: number; rejected: number; duplicate: number; total: number };

let syncing: Promise<SyncOutcome> | null = null;

/** Sends every queued action. Network failure leaves the queue untouched and throws NETWORK. */
export function syncQueue(): Promise<SyncOutcome> {
  if (syncing) return syncing;
  syncing = (async () => {
    const outcome: SyncOutcome = { applied: 0, rejected: 0, duplicate: 0, total: 0 };
    try {
      const all = await listQueue();
      if (!all.length) return outcome;
      const deviceId = await getDeviceId();
      const db = await getDb();
      for (let i = 0; i < all.length; i += 100) {
        const chunk = all.slice(i, i + 100);
        const actions: OfflineAction[] = chunk.map((a) => ({
          action_id: a.action_id,
          type: a.type,
          queued_at: a.queued_at,
          base_version: a.base_version,
          payload: a.payload,
        }));
        let res: { results: any[] };
        try {
          res = await api('/audit/v1/offline-sync', { method: 'POST', body: { device_id: deviceId, actions } });
        } catch (e) {
          if (e instanceof AppError && !e.isNetwork) {
            for (const a of chunk) {
              await db.runAsync("UPDATE queue SET status = 'error', error = ? WHERE action_id = ?", e.message, a.action_id);
            }
            emit();
          }
          throw e;
        }
        const at = utcNow();
        for (const r of res.results ?? []) {
          const label = chunk.find((a) => a.action_id === r.action_id)?.label ?? 'Action';
          await db.runAsync(
            'INSERT INTO sync_results (action_id, status, error_code, message, at) VALUES (?, ?, ?, ?, ?)',
            r.action_id,
            r.status,
            r.error_code ?? null,
            resultMessage(r),
            at,
          );
          await setMeta('rlabel:' + r.action_id, label);
          await db.runAsync('DELETE FROM queue WHERE action_id = ?', r.action_id);
          await setMeta('label:' + r.action_id, null);
          if (r.status === 'applied') outcome.applied++;
          else if (r.status === 'duplicate') outcome.duplicate++;
          else outcome.rejected++;
          outcome.total++;
        }
        emit();
      }
      return outcome;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}
