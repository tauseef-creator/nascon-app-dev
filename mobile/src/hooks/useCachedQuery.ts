// Loads a GET endpoint through the SQLite read cache; exposes loading/error/fromCache state.
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '../api/errors';
import { cachedGet } from '../offline/cache';
import { useSync } from '../offline/SyncProvider';

export function useCachedQuery<T>(key: string | null, path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!key);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const { online } = useSync();
  const seq = useRef(0);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
      if (!key || !path) return;
      const my = ++seq.current;
      if (mode === 'initial') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      try {
        const r = await cachedGet<T>(key, path);
        if (my !== seq.current) return;
        setData(r.data);
        setFromCache(r.fromCache);
        setUpdatedAt(r.updatedAt);
        setError(null);
        setErrorCode(null);
      } catch (e: any) {
        if (my !== seq.current) return;
        setError(errorText(e));
        setErrorCode(e?.code ?? null);
      } finally {
        if (my === seq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [key, path],
  );

  useEffect(() => {
    setData(null);
    load('initial');
  }, [load]);

  // Refresh automatically when the connection comes back.
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current) load('silent');
    wasOnline.current = online;
  }, [online, load]);

  return {
    data,
    setData,
    loading,
    refreshing,
    error,
    errorCode,
    fromCache,
    updatedAt,
    refresh: () => load('refresh'),
    reload: () => load('silent'),
  };
}
