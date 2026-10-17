// Selected league shared by the Fixtures and Standings tabs.
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { League } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useCachedQuery } from '../hooks/useCachedQuery';

type LeagueState = {
  leagues: League[];
  league: League | null;
  select: (id: string) => void;
  loading: boolean;
  error: string | null;
  fromCache: boolean;
  updatedAt: string | null;
  refresh: () => void;
};

const KEY = 'nascon.league';
const Ctx = createContext<LeagueState | null>(null);

export function LeagueProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const q = useCachedQuery<{ leagues: League[] }>(user ? `leagues:${user.tenant_id ?? 'all'}` : null, user ? '/api/v1/leagues' : null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => v && setSelected(v))
      .catch(() => {});
  }, []);

  const leagues = q.data?.leagues ?? [];
  const league = useMemo(() => {
    if (!leagues.length) return null;
    return (
      leagues.find((l) => l.league_id === selected) ??
      leagues.find((l) => l.league_id === user?.league_id) ??
      leagues[0]!
    );
  }, [leagues, selected, user?.league_id]);

  const value = useMemo<LeagueState>(
    () => ({
      leagues,
      league,
      select: (id: string) => {
        setSelected(id);
        AsyncStorage.setItem(KEY, id).catch(() => {});
      },
      loading: q.loading,
      error: q.error,
      fromCache: q.fromCache,
      updatedAt: q.updatedAt,
      refresh: q.refresh,
    }),
    [leagues, league, q.loading, q.error, q.fromCache, q.updatedAt, q.refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLeague() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLeague outside LeagueProvider');
  return v;
}
