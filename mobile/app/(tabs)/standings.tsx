import { router } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StandingRow, Standings } from '../../src/api/types';
import { useAuth, useBrand } from '../../src/auth/AuthContext';
import { ClubCrest } from '../../src/components/ClubCrest';
import { LeaguePicker } from '../../src/components/LeaguePicker';
import { Screen } from '../../src/components/Screen';
import { CachedNotice, Card, EmptyState, ErrorBanner, LoadingView, PillKind, SectionTitle, StatusPill } from '../../src/components/ui';
import { useCachedQuery } from '../../src/hooks/useCachedQuery';
import { useClubNames } from '../../src/hooks/useClubNames';
import { useLeague } from '../../src/store/LeagueContext';
import { colors, spacing, text } from '../../src/theme';

const COLS: { key: keyof StandingRow; label: string; long: string; w: number }[] = [
  { key: 'played', label: 'P', long: 'Played', w: 40 },
  { key: 'won', label: 'W', long: 'Won', w: 40 },
  { key: 'drawn', label: 'D', long: 'Drawn', w: 40 },
  { key: 'lost', label: 'L', long: 'Lost', w: 40 },
  { key: 'scored', label: 'F', long: 'Scored (for)', w: 44 },
  { key: 'conceded', label: 'A', long: 'Conceded (against)', w: 44 },
  { key: 'diff', label: '+/-', long: 'Difference', w: 50 },
  { key: 'points', label: 'Pts', long: 'Points', w: 52 },
];

function pillFor(status: string): PillKind {
  if (status === 'clinched') return 'clinched';
  if (status === 'eliminated') return 'eliminated';
  return 'possible';
}

export default function StandingsTab() {
  const { user } = useAuth();
  const brand = useBrand();
  const lg = useLeague();
  const id = lg.league?.league_id ?? null;
  const q = useCachedQuery<Standings>(id ? `standings:${id}` : null, id ? `/audit/v1/standings/${encodeURIComponent(id)}` : null);
  const name = useClubNames();
  const notAvailable = q.errorCode === 'LEAGUE_NOT_FOUND' || q.errorCode === 'NOT_FOUND';
  const rows = q.data?.table ?? [];
  const spots = q.data?.qualification_spots ?? 0;

  let body: React.ReactNode;
  if (lg.loading && !lg.leagues.length) body = <LoadingView label="Loading leagues…" />;
  else if (!lg.leagues.length && lg.error) body = <ErrorBanner message={lg.error} onRetry={lg.refresh} />;
  else if (!lg.leagues.length) body = <EmptyState icon="podium-outline" title="No leagues yet" message="Standings appear once a league exists." />;
  else if (q.loading && !q.data) body = <LoadingView label="Loading standings…" />;
  else if (notAvailable && !q.data)
    body = (
      <EmptyState
        icon="podium-outline"
        title="Standings are not available for this league yet"
        message="The table appears after the league's first results are recorded."
        testID="standings-empty"
      />
    );
  else if (q.error && !q.data) body = <ErrorBanner message={q.error} onRetry={q.refresh} testID="standings-error" />;
  else if (!rows.length)
    body = <EmptyState icon="podium-outline" title="No teams in the table yet" message="Teams appear here after their first match." testID="standings-empty" />;
  else
    body = (
      <>
        <Card style={{ padding: 0, overflow: 'hidden', borderRadius: 24 }} testID="standings-table">
          <Text style={styles.tableTitle} accessibilityRole="header">{lg.league?.name ?? 'Table'}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator accessibilityLabel="Standings table, scroll sideways for more columns">
            <View>
              <View style={[styles.tr, styles.th]}>
                <Text style={[styles.cell, styles.hcell, { width: 40 }]}>#</Text>
                <Text style={[styles.cell, styles.hcell, styles.teamCol]}>Team</Text>
                {COLS.map((c) => (
                  <Text key={c.key} style={[styles.cell, styles.hcell, { width: c.w }]} accessibilityLabel={c.long}>
                    {c.label}
                  </Text>
                ))}
                <Text style={[styles.cell, styles.hcell, { width: 170, textAlign: 'left' }]}>Qualification</Text>
              </View>
              {rows.map((r) => {
                const mine = r.team_id === user?.club_id;
                const inZone = spots > 0 && r.rank <= spots;
                return (
                  <Pressable
                    key={r.team_id}
                    testID={`standings-row-${r.team_id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Rank ${r.rank}, ${name(r.team_id)}, ${r.points} points, played ${r.played}, status ${r.status.replace('_', ' ')}. Opens club profile.`}
                    onPress={() => router.push(`/club/${r.team_id}`)}
                    style={({ pressed }) => [
                      styles.tr,
                      mine && { backgroundColor: colors.accentBg },
                      pressed && { backgroundColor: colors.neutralBg },
                    ]}
                  >
                    <View style={styles.rankCell}>
                      <Text style={[styles.cell, { width: 36, fontFamily: 'Inter_800ExtraBold' }, inZone && { color: colors.accent }]}>{r.rank}</Text>
                    </View>
                    <View style={[styles.teamCol, styles.teamCell]}>
                      <ClubCrest name={name(r.team_id)} size={18} />
                      <Text style={[styles.cell, { fontFamily: 'Inter_700Bold', textAlign: 'left', flex: 1 }]} numberOfLines={2}>
                        {name(r.team_id)}
                        {mine ? ' (you)' : ''}
                      </Text>
                    </View>
                    {COLS.map((c) => (
                      <Text key={c.key} style={[styles.cell, { width: c.w }, c.key === 'points' && { fontFamily: 'Inter_800ExtraBold' }]}>
                        {c.key === 'diff' && r.diff > 0 ? `+${r.diff}` : String(r[c.key])}
                      </Text>
                    ))}
                    <View style={{ width: 170, justifyContent: 'center', paddingHorizontal: 6 }}>
                      <StatusPill kind={pillFor(r.status)} />
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </Card>
        <SectionTitle>How to read this table</SectionTitle>
        <Card testID="standings-legend">
          <Text style={[text.body, { marginBottom: spacing.sm }]}>
            P played, W won, D drawn, L lost, F scored, A conceded, +/- difference, Pts points.
          </Text>
          {spots > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
              <Text style={{ color: colors.accent, fontFamily: 'Inter_800ExtraBold', fontSize: 16, width: 16, textAlign: 'center' }}>1</Text>
              <Text style={[text.body, { flex: 1 }]}>Green rank number: currently in the top {spots} qualification places.</Text>
            </View>
          ) : null}
          <View style={{ gap: spacing.sm }}>
            <LegendRow kind="clinched" text="Qualification is certain." />
            <LegendRow kind="possible" text="Can still qualify." />
            <LegendRow kind="eliminated" text="Can no longer qualify." />
          </View>
          <Text style={[text.small, { marginTop: spacing.sm }]}>Tap a team to open its club profile.</Text>
        </Card>
      </>
    );

  return (
    <Screen title="Standings" onRefresh={q.refresh} refreshing={q.refreshing} testID="standings-screen">
      <LeaguePicker />
      {q.fromCache && q.updatedAt ? <CachedNotice updatedAt={q.updatedAt} /> : null}
      {body}
    </Screen>
  );
}

function LegendRow({ kind, text: t }: { kind: PillKind; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
      <StatusPill kind={kind} />
      <Text style={[text.body, { flex: 1, minWidth: 140 }]}>{t}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tableTitle: { color: colors.text, fontSize: 17, fontFamily: 'Inter_700Bold', textAlign: 'center', paddingTop: spacing.lg, paddingBottom: spacing.xs },
  tr: { flexDirection: 'row', alignItems: 'center', minHeight: 44, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  th: { minHeight: 40 },
  cell: { fontSize: 13, color: colors.text, textAlign: 'center', paddingVertical: 8, fontVariant: ['tabular-nums'] },
  hcell: { fontFamily: 'Inter_600SemiBold', color: colors.textMuted, fontSize: 11 },
  teamCol: { width: 170, textAlign: 'left', paddingHorizontal: 6 },
  teamCell: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rankCell: { alignSelf: 'stretch', justifyContent: 'center', paddingLeft: 4 },
});
