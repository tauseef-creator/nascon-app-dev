import React, { useMemo } from 'react';
import { Match } from '../../src/api/types';
import { LeaguePicker } from '../../src/components/LeaguePicker';
import { MatchCard } from '../../src/components/MatchCard';
import { Screen } from '../../src/components/Screen';
import { CachedNotice, EmptyState, ErrorBanner, LoadingView, SectionTitle } from '../../src/components/ui';
import { useCachedQuery } from '../../src/hooks/useCachedQuery';
import { useLeague } from '../../src/store/LeagueContext';

export default function Fixtures() {
  const lg = useLeague();
  const id = lg.league?.league_id ?? null;
  const q = useCachedQuery<{ matches: Match[] }>(id ? `matches:${id}` : null, id ? `/api/v1/matches?league_id=${encodeURIComponent(id)}` : null);

  const groups = useMemo(() => {
    const all = q.data?.matches ?? [];
    const by = (a: Match, b: Match) => a.scheduled_at.localeCompare(b.scheduled_at);
    return {
      live: all.filter((m) => m.status === 'in_progress').sort(by),
      upcoming: all.filter((m) => m.status !== 'in_progress' && m.status !== 'completed').sort(by),
      results: all.filter((m) => m.status === 'completed').sort((a, b) => -by(a, b)),
    };
  }, [q.data]);

  const refresh = () => {
    lg.refresh();
    q.refresh();
  };

  let body: React.ReactNode;
  if (lg.loading && !lg.leagues.length) body = <LoadingView label="Loading leagues…" />;
  else if (lg.error && !lg.leagues.length) body = <ErrorBanner message={lg.error} onRetry={lg.refresh} />;
  else if (!lg.leagues.length)
    body = <EmptyState icon="trophy-outline" title="No leagues yet" message="When your organisation creates a league, its fixtures will appear here." />;
  else if (q.loading && !q.data) body = <LoadingView label="Loading fixtures…" />;
  else if (q.error && !q.data) body = <ErrorBanner message={q.error} onRetry={q.refresh} testID="fixtures-error" />;
  else if (!groups.live.length && !groups.upcoming.length && !groups.results.length)
    body = (
      <EmptyState
        icon="calendar-outline"
        title="No matches yet"
        message="This league has no fixtures scheduled. Pull down to check again."
        testID="fixtures-empty"
      />
    );
  else
    body = (
      <>
        {q.error ? <ErrorBanner message={q.error} onRetry={q.refresh} /> : null}
        {groups.live.length ? <SectionTitle>Live now ({groups.live.length})</SectionTitle> : null}
        {groups.live.map((m) => (
          <MatchCard key={m.match_id} m={m} />
        ))}
        {groups.upcoming.length ? <SectionTitle>Upcoming ({groups.upcoming.length})</SectionTitle> : null}
        {groups.upcoming.map((m) => (
          <MatchCard key={m.match_id} m={m} />
        ))}
        {groups.results.length ? <SectionTitle>Results ({groups.results.length})</SectionTitle> : null}
        {groups.results.map((m) => (
          <MatchCard key={m.match_id} m={m} />
        ))}
      </>
    );

  return (
    <Screen title="Fixtures" subtitle={lg.league?.name} onRefresh={refresh} refreshing={q.refreshing} testID="fixtures-screen">
      <LeaguePicker />
      {q.fromCache && q.updatedAt ? <CachedNotice updatedAt={q.updatedAt} /> : null}
      {body}
    </Screen>
  );
}
