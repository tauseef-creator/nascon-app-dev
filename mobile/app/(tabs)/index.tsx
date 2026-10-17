import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Match } from '../../src/api/types';
import { canManageRoster, canScore, useAuth } from '../../src/auth/AuthContext';
import { ClubCrest } from '../../src/components/ClubCrest';
import { LeaguePicker } from '../../src/components/LeaguePicker';
import { MatchCard } from '../../src/components/MatchCard';
import { Screen } from '../../src/components/Screen';
import { CachedNotice, EmptyState, ErrorBanner, formatDateTime, formatTime, LoadingView } from '../../src/components/ui';
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
  const { user } = useAuth();
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
  const featured = groups.live[0] ?? groups.upcoming[0] ?? groups.results[0];
  const leadAction = canScore(user?.role) && groups.live.length
    ? { label: 'Score live match', icon: 'radio-button-on' as const, href: `/match/${groups.live[0]!.match_id}` }
    : canManageRoster(user?.role) && user?.club_id
      ? { label: 'Manage roster', icon: 'people' as const, href: '/roster' }
      : { label: 'Explore matches', icon: 'calendar' as const, href: featured ? `/match/${featured.match_id}` : '/' };

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
        {featured ? (
          <Pressable
            testID="featured-match"
            accessibilityRole="button"
            accessibilityLabel={`Featured match. ${featured.home_name} versus ${featured.away_name}. Open match details.`}
            onPress={() => router.push(`/match/${featured.match_id}`)}
            style={({ pressed }) => [styles.hero, pressed && { opacity: 0.88 }]}
          >
            <Image source={require('../../assets/stadium.jpg')} style={StyleSheet.absoluteFill} contentFit="cover" />
            <LinearGradient colors={['rgba(0,0,0,0.38)', 'rgba(0,0,0,0.82)', '#101A14']} locations={[0, 0.53, 1]} style={StyleSheet.absoluteFill} />
            <View style={styles.heroTop}>
              <View style={styles.heroBadge}><View style={[styles.badgeDot, featured.status !== 'in_progress' && { backgroundColor: colors.accent }]} /><Text style={styles.heroBadgeText}>{featured.status === 'in_progress' ? 'LIVE NOW' : featured.status === 'completed' ? 'LATEST RESULT' : 'NEXT MATCH'}</Text></View>
              <Ionicons name="arrow-forward" size={20} color={colors.white} />
            </View>
            <View style={styles.heroTeams}>
              <View style={styles.heroClub}><ClubCrest name={featured.home_name} size={42} /><Text style={styles.heroClubName} numberOfLines={2}>{featured.home_name}</Text></View>
              <View style={styles.heroCenter}>
                <Text style={styles.heroScore}>{featured.status === 'upcoming' ? formatTime(featured.scheduled_at) : `${featured.home_score} : ${featured.away_score}`}</Text>
                <Text style={styles.heroDate}>{featured.status === 'in_progress' ? 'MATCH IN PROGRESS' : featured.status === 'completed' ? 'FULL TIME' : formatDateTime(featured.scheduled_at)}</Text>
              </View>
              <View style={styles.heroClub}><ClubCrest name={featured.away_name} size={42} /><Text style={styles.heroClubName} numberOfLines={2}>{featured.away_name}</Text></View>
            </View>
            <Text style={styles.heroVenue} numberOfLines={1}>{featured.venue ?? lg.league?.name ?? 'Match centre'}</Text>
          </Pressable>
        ) : null}
        <View style={styles.summary} testID="fixtures-summary">
          <View style={styles.summaryItem}><Text style={styles.summaryNumber}>{groups.live.length}</Text><Text style={styles.summaryLabel}>LIVE</Text></View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}><Text style={styles.summaryNumber}>{groups.upcoming.length}</Text><Text style={styles.summaryLabel}>UPCOMING</Text></View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}><Text style={styles.summaryNumber}>{groups.results.length}</Text><Text style={styles.summaryLabel}>RESULTS</Text></View>
        </View>
        <View style={styles.quickLinks}>
          <Pressable testID="home-primary-action" accessibilityRole="button" accessibilityLabel={leadAction.label} onPress={() => router.push(leadAction.href as never)} style={styles.quickLink}>
            <Ionicons name={leadAction.icon} size={18} color={colors.accent} /><Text style={styles.quickText} numberOfLines={1}>{leadAction.label}</Text><Ionicons name="chevron-forward" size={15} color={colors.textMuted} />
          </Pressable>
          <Pressable testID="home-standings" accessibilityRole="button" accessibilityLabel="View standings" onPress={() => router.push('/standings')} style={styles.quickLink}>
            <Ionicons name="podium" size={18} color={colors.accent} /><Text style={styles.quickText}>Standings</Text><Ionicons name="chevron-forward" size={15} color={colors.textMuted} />
          </Pressable>
        </View>
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
  hero: { height: 224, borderRadius: 24, overflow: 'hidden', padding: spacing.lg, justifyContent: 'space-between', marginBottom: spacing.md, backgroundColor: colors.card },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  badgeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.live },
  heroBadgeText: { color: colors.white, fontSize: 10, fontFamily: 'Inter_800ExtraBold', letterSpacing: 0.8 },
  heroTeams: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroClub: { width: 82, alignItems: 'center', gap: 5 },
  heroClubName: { color: colors.white, fontSize: 11, lineHeight: 14, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  heroCenter: { flex: 1, alignItems: 'center' },
  heroScore: { color: colors.white, fontSize: 31, fontFamily: 'Inter_800ExtraBold', letterSpacing: -1 },
  heroDate: { color: '#E3E3E6', fontSize: 10, fontFamily: 'Inter_700Bold', textAlign: 'center', marginTop: 3 },
  heroVenue: { color: '#D6D6DA', fontSize: 11, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  summary: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 20, paddingVertical: spacing.md, marginBottom: spacing.md },
  summaryItem: { flex: 1, alignItems: 'center', gap: 3 },
  summaryNumber: { color: colors.text, fontSize: 22, fontFamily: 'Inter_800ExtraBold' },
  summaryLabel: { color: colors.textMuted, fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 0.8 },
  summaryDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  quickLinks: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  quickLink: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.sm, borderRadius: 15, backgroundColor: colors.card },
  quickText: { flex: 1, color: colors.text, fontSize: 11, fontFamily: 'Inter_700Bold' },
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
