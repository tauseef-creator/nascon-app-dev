// Connectivity + sync state for the whole app. Auto-syncs the queue on reconnect,
// on app foreground and every 20 s while there is something pending.
import NetInfo from '@react-native-community/netinfo';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { api, setReachabilityHandler } from '../api/client';
import { AppError } from '../api/errors';
import { setOnlineNow } from './netState';
import { ActionType, enqueueAction, pendingCount, subscribeQueue, syncQueue, SyncOutcome } from './queue';

export type SyncState = {
  online: boolean;
  /** Device connected but the server did not answer the last request. */
  serverDown: boolean;
  syncing: boolean;
  pending: number;
  lastOutcome: SyncOutcome | null;
  lastError: string | null;
  syncNow: () => Promise<SyncOutcome | null>;
  /**
   * Sends a write now, or queues it in spec 5.14 format if the device is offline or the
   * request fails because of the network. Server rule errors are thrown to the caller.
   */
  submitOrQueue: <T = any>(args: {
    type: ActionType;
    path: string;
    body: any;
    baseVersion: number;
    label: string;
  }) => Promise<{ queued: true } | { queued: false; data: T }>;
};

const Ctx = createContext<SyncState | null>(null);

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(true);
  const [serverDown, setServerDown] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pending, setPending] = useState(0);
  const [lastOutcome, setLastOutcome] = useState<SyncOutcome | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const onlineRef = useRef(true);
  const pendingRef = useRef(0);

  const refreshCount = useCallback(async () => {
    try {
      const n = await pendingCount();
      pendingRef.current = n;
      setPending(n);
    } catch {
      // database not ready yet
    }
  }, []);

  const syncNow = useCallback(async (): Promise<SyncOutcome | null> => {
    if (pendingRef.current === 0) {
      await refreshCount();
      if (pendingRef.current === 0) return null;
    }
    setSyncing(true);
    setLastError(null);
    try {
      const out = await syncQueue();
      if (out.total > 0) setLastOutcome(out);
      setServerDown(false);
      return out;
    } catch (e) {
      const err = e instanceof AppError ? e : new AppError('UNKNOWN');
      setLastError(
        err.isNetwork
          ? "Couldn't reach the server. Your actions are still saved and will be sent when the connection is back."
          : err.message,
      );
      return null;
    } finally {
      setSyncing(false);
      refreshCount();
    }
  }, [refreshCount]);

  useEffect(() => {
    refreshCount();
    const unsubQueue = subscribeQueue(refreshCount);
    setReachabilityHandler((ok) => setServerDown(!ok));
    const unsubNet = NetInfo.addEventListener((s) => {
      const isOn = s.isConnected !== false;
      const wasOn = onlineRef.current;
      onlineRef.current = isOn;
      setOnlineNow(isOn);
      setConnected(isOn);
      if (isOn && !wasOn) {
        // Give the radio a moment, then flush the queue automatically.
        setTimeout(() => {
          syncNow();
        }, 1500);
      }
    });
    const appSub = AppState.addEventListener('change', (st) => {
      if (st === 'active' && onlineRef.current) syncNow();
    });
    const timer = setInterval(() => {
      if (onlineRef.current && pendingRef.current > 0) syncNow();
    }, 20000);
    // First launch: try once (covers "force-closed while offline, reopened online").
    const first = setTimeout(() => {
      if (onlineRef.current) syncNow();
    }, 2500);
    return () => {
      unsubQueue();
      unsubNet();
      appSub.remove();
      clearInterval(timer);
      clearTimeout(first);
      setReachabilityHandler(null);
    };
  }, [refreshCount, syncNow]);

  const submitOrQueue = useCallback<SyncState['submitOrQueue']>(
    async ({ type, path, body, baseVersion, label }) => {
      if (!onlineRef.current) {
        await enqueueAction(type, body, baseVersion, label);
        return { queued: true };
      }
      try {
        const data = await api(path, { method: 'POST', body });
        return { queued: false, data };
      } catch (e) {
        if (e instanceof AppError && e.isNetwork) {
          await enqueueAction(type, body, baseVersion, label);
          return { queued: true };
        }
        throw e;
      }
    },
    [],
  );

  const value = useMemo<SyncState>(
    () => ({
      online: connected,
      serverDown: connected && serverDown,
      syncing,
      pending,
      lastOutcome,
      lastError,
      syncNow,
      submitOrQueue,
    }),
    [connected, serverDown, syncing, pending, lastOutcome, lastError, syncNow, submitOrQueue],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSync(): SyncState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSync outside SyncProvider');
  return v;
}
