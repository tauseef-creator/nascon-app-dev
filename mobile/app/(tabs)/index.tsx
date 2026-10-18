import { Icon } from '../../src/components/Icon';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Match } from '../../src/api/types';
import { canScore, managesLeague, useAuth } from '../../src/auth/AuthContext';
import { ClubCrest } from '../../src/components/ClubCrest';
import { LeaguePicker } from '../../src/components/LeaguePicker';
import { MatchCard } from '../../src/components/MatchCard';
import { RoleHome } from '../../src/components/RoleHome';
import { Screen } from '../../src/components/Screen';
import { CachedNotice, EmptyState, ErrorBanner, formatDateTime, formatTime, LoadingView, PrimaryButton, SectionTitle } from '../../src/components/ui';
import { useCachedQuery } from '../../src/hooks/useCachedQuery';
import { useLeague } from '../../src/store/LeagueContext';
import { colors, spacing } from '../../src/theme';
import { isFinished, isFrozen, isPending, statusLabel } from '../../src/utils/matchStatus';

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
    // Postponed matches stay under Upcoming; abandoned and cancelled ones are over, so they sit under Results.
    return {
      live: all.filter((m) => m.status === 'in_progress').sort(by),
      upcoming: all.filter((m) => isPending(m.status)).sort(by),
      results: all.filter((m) => isFinished(m.status)).sort((a, b) => -by(a, b)),
    };
  }, [q.data]);

  // Refresh quietly when returning to Home (for example after postponing a match), not on first mount.
  const focused = useRef(false);
  const reloadRef = useRef(q.reload);
  reloadRef.current = q.reload;
  useFocusEffect(
    useCallback(() => {
      if (focused.current) reloadRef.current();
      focused.current = true;
    }, []),
  );

  const [picked, setPicked] = useState<Tab | null>(null);
  const tab: Tab = picked ?? (groups.live.length ? 'live' : groups.upcoming.length ? 'upcoming' : 'results');
  const shown = groups[tab];
  // One hero card: the live match, else the next upcoming match, else the latest result. Postponed
  // matches are left out because organizers already see them under "Needs attention".
  const featured = groups.live[0] ?? groups.upcoming.find((m) => m.status === 'upcoming') ?? groups.results[0];
  const featuredTimeOnly = featured ? featured.status === 'upcoming' || featured.status === 'postponed' || featured.status === 'cancelled' : false;
  const featuredLive = featured?.status === 'in_progress';
  const featuredBadge = featuredLive ? 'LIVE NOW' : featured && isFinished(featured.status) ? 'LATEST RESULT' : 'NEXT MATCH';
  const featuredCenter = featured ? (featuredTimeOnly ? formatTime(featured.scheduled_at) : `${featured.home_score} : ${featured.away_score}`) : '';
  const featuredDetail = !featured
    ? ''
    : featuredLive
      ? 'MATCH IN PROGRESS'
      : featured.status === 'completed'
        ? 'FULL TIME'
        : isFrozen(featured.status)
          ? statusLabel(featured.status).toUpperCase()
          : formatDateTime(featured.scheduled_at);
  const featuredA11y = !featured
    ? ''
    : `${featuredLive ? 'Live now' : isFinished(featured.status) ? 'Latest result' : 'Next match'}. ${featured.home_name} versus ${featured.away_name}. ${
        isFrozen(featured.status)
          ? statusLabel(featured.status)
          : featuredTimeOnly
            ? `Kick-off ${formatDateTime(featured.scheduled_at)}`
            : `Score ${featured.home_score} to ${featured.away_score}${featuredLive ? ', in progress' : ', full time'}`
      }. Open match details.`;
  const showScore = !!featured && featuredLive && managesLeague(user, id);
  const isViewerHome = !!user && !managesLeague(user, id) && !((user.role === 'club_manager' || user.role === 'player') && user.club_id);
  const roleHome = q.data ? <RoleHome matches={q.data.matches} leagueId={id} heroId={featured?.match_id ?? null} /> : null;

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
      <>
      {roleHome}
      <EmptyState
        icon="calendar-outline"
        title="No matches yet"
        message="This league has no fixtures scheduled. Pull down to check again."
        testID="fixtures-empty"
      />
      </>
    );
  else
    body = (
      <>
        {q.error ? <ErrorBanner message={q.error} onRetry={q.refresh} /> : null}
        {featured ? (
          <View style={styles.hero} testID="home-hero">
            <Image source={require('../../assets/stadium.jpg')} style={StyleSheet.absoluteFill} contentFit="cover" />
            <LinearGradient colors={['rgba(0,0,0,0.38)', 'rgba(0,0,0,0.82)', '#101A14']} locations={[0, 0.53, 1]} style={StyleSheet.absoluteFill} />
            <Pressable
              testID="featured-match"
              accessibilityRole="button"
              accessibilityLabel={featuredA11y}
              onPress={() => router.push(`/match/${featured.match_id}`)}
              style={({ pressed }) => [styles.heroBody, pressed && { opacity: 0.88 }]}
            >
              <View style={styles.heroTop}>
                <View style={styles.heroBadge}><View style={[styles.badgeDot, !featuredLive && { backgroundColor: colors.accent }]} /><Text style={styles.heroBadgeText}>{featuredBadge}</Text></View>
                <Icon name="arrow-forward" size={20} color={colors.white} />
              </View>
              <View style={styles.heroTeams}>
                <View style={styles.heroClub}><ClubCrest name={featured.home_name} size={42} /><Text style={styles.heroClubName} numberOfLines={2}>{featured.home_name}</Text></View>
                <View style={styles.heroCenter}>
                  <Text style={styles.heroScore}>{featuredCenter}</Text>
                  <Text style={styles.heroDate}>{featuredDetail}</Text>
                </View>
                <View style={styles.heroClub}><ClubCrest name={featured.away_name} size={42} /><Text style={styles.heroClubName} numberOfLines={2}>{featured.away_name}</Text></View>
              </View>
              <Text style={styles.heroVenue} numberOfLines={1}>{featured.venue ?? lg.league?.name ?? 'Match centre'}</Text>
            </Pressable>
            {showScore ? (
              <View style={styles.heroAction}>
                <PrimaryButton
                  title="Score match"
                  icon="radio-button-on"
                  onPress={() => router.push(`/match/${featured.match_id}`)}
                  testID={`home-score-${featured.match_id}`}
                  accessibilityLabel={`Score match: ${featured.home_name} versus ${featured.away_name}`}
                />
              </View>
            ) : null}
          </View>
        ) : null}
        {roleHome}
        {isViewerHome ? null : (
          <View style={styles.quickLinks}>
            <Pressable testID="home-standings" accessibilityRole="button" accessibilityLabel="View standings" onPress={() => router.push('/standings')} style={styles.quickLink}>
              <Icon name="podium" size={18} color={colors.accent} /><Text style={styles.quickText}>Standings</Text><Icon name="chevron-forward" size={15} color={colors.textMuted} />
            </Pressable>
          </View>
        )}
        <SectionTitle>All fixtures</SectionTitle>
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
                    <Text style={[styles.segText, on && styles.segTextOn]}>{`${t.label} (${n})`}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.leagueRow}>
            <View style={styles.leagueIcon}>
              <Icon name="trophy" size={13} color={colors.accent} />
            </View>
            <Text style={styles.leagueName} numberOfLines={1}>{lg.league?.name ?? 'League'}</Text>
            <Icon name="chevron-forward" size={14} color={colors.textMuted} />
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
    <Screen title="Home" logoOnly onRefresh={refresh} refreshing={q.refreshing} testID="fixtures-screen">
      <LeaguePicker />
      {q.fromCache && q.updatedAt ? <CachedNotice updatedAt={q.updatedAt} /> : null}
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: 24, overflow: 'hidden', marginBottom: spacing.md, backgroundColor: colors.card },
  heroBody: { height: 224, padding: spacing.lg, justifyContent: 'space-between' },
  heroAction: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
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
