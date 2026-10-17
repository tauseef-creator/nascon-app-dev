import { useMemo } from 'react';
import { Club } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useCachedQuery } from './useCachedQuery';

export function useClubs() {
  const { user } = useAuth();
  return useCachedQuery<{ clubs: Club[] }>(user ? `clubs:${user.tenant_id ?? 'all'}` : null, user ? '/api/v1/clubs' : null);
}

/** team_id -> club name lookup (falls back to the id). */
export function useClubNames() {
  const q = useClubs();
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const c of q.data?.clubs ?? []) map.set(c.club_id, c.name);
    return (id: string | null | undefined, fallback?: string) => (id ? map.get(id) ?? fallback ?? id : fallback ?? '');
  }, [q.data]);
}

export function humanize(s: string | null | undefined): string {
  if (!s) return '';
  const t = s.replace(/[_-]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
