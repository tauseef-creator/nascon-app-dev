import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Match } from '../../src/api/types';
import { LeaguePicker } from '../../src/components/LeaguePicker';
import { MatchCard } from '../../src/components/MatchCard';
import { Screen } from '../../src/components/Screen';
import { CachedNotice, EmptyState, ErrorBanner, LoadingView } from '../../src/components/ui';
import { useCachedQuery } from '../../src/hooks/useCachedQuery';
import { useLeague } from '../../src/store/LeagueContext';
import { colors, spacing } from '../../src/theme';

type Tab = 'results' | 'live' | 'upcoming';
const TABS: { key: Tab; label: string }[] = [
  { key: 'results', label: 'Results' },
  { key: 'live', label: 'Live' },
  { key: 'upcoming', label: 'Upcoming' },
];
const EMPTY: Record<Tab, string> = { results: 'No Results Yet', live: 'No Live Matches', upcoming: 'No Upcoming Matches' };

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

  const [picked, setPicked] = useState<Tab | null>(null);
  const tab: Tab = picked ?? (groups.live.length ? 'live' : groups.upcoming.length ? 'upcoming' : 'results');
  const shown = groups[tab];

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
        <View style={styles.panel} testID="fixtures-panel">
          <View style={styles.segment} accessibilityRole="tablist">
            {TABS.map((t) => {
              const on = t.key === tab;
              const n = groups[t.key].length;
              return (
                <Pressable
                  key={t.key}
                  testID={`fixtures-tab-${t.key}`}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${t.label}, ${n} match${n === 1 ? '' : 'es'}`}
                  onPress={() => setPicked(t.key)}
                  style={styles.segBtn}
                >
                  <View style={styles.segLabel}>
                    {t.key === 'live' && n ? <View style={styles.liveDot} /> : null}
                    <Text style={[styles.segText, on && styles.segTextOn]}>{t.label}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.leagueRow}>
            <View style={styles.leagueIcon}>
              <Ionicons name="trophy" size={13} color={colors.accent} />
            </View>
            <Text style={styles.leagueName} numberOfLines={1}>{lg.league?.name ?? 'League'}</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
          </View>
          {shown.length ? (
            shown.map((m) => <MatchCard key={m.match_id} m={m} />)
          ) : (
            <Text style={styles.none} testID={`fixtures-none-${tab}`}>{EMPTY[tab]}</Text>
          )}
        </View>
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

const styles = StyleSheet.create({
  panel: { backgroundColor: 'rgba(28,28,30,0.92)', borderRadius: 24, overflow: 'hidden', paddingBottom: spacing.sm, marginBottom: spacing.md },
  segment: { flexDirection: 'row', paddingHorizontal: spacing.sm, paddingTop: spacing.xs },
  segBtn: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  segLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  segText: { color: colors.textMuted, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  segTextOn: { color: colors.text, fontFamily: 'Inter_700Bold' },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.live },
  leagueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  leagueIcon: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.cardHi, alignItems: 'center', justifyContent: 'center' },
  leagueName: { color: colors.text, fontSize: 13, fontFamily: 'Inter_700Bold', flexShrink: 1 },
  none: { color: colors.text, fontSize: 17, fontFamily: 'Inter_700Bold', textAlign: 'center', paddingVertical: spacing.xxl },
});
