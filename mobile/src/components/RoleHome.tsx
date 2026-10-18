// Role-aware section of the Home tab, shown below the hero card. Every match appears once on
// Home, so this section never repeats the hero match or a list the fixtures tabs already show.
// It reuses the fixtures already loaded by Home and the same cache keys as the Roster and
// Standings screens, so it adds at most one request.
import { Icon } from './Icon';
import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Match, RosterState, Standings } from '../api/types';
import { canScore, managesLeague, useAuth } from '../auth/AuthContext';
import { useCachedQuery } from '../hooks/useCachedQuery';
import { useClubNames } from '../hooks/useClubNames';
import { colors, radius, spacing, text } from '../theme';
import { byTime, formatDay, involves, isFinished, isPending, OFF_SCHEDULE } from '../utils/matchStatus';
import { ClubCrest } from './ClubCrest';
import { ManagePanel, ManageSection, toolsCaption } from './ManagePanel';
import { MatchCard } from './MatchCard';
import { ErrorBanner, formatDateTime, PressableCard, PrimaryButton, Row, SecondaryButton, SectionTitle } from './ui';

type IconName = React.ComponentProps<typeof Icon>['name'];

export function RoleHome({ matches, leagueId, heroId }: { matches: Match[]; leagueId: string | null; heroId: string | null }) {
  const { user } = useAuth();
  const g = useMemo(() => {
    const sorted = [...matches].sort(byTime);
    return {
      live: sorted.filter((m) => m.status === 'in_progress'),
      postponed: sorted.filter((m) => m.status === 'postponed'),
      pending: sorted.filter((m) => isPending(m.status)),
      finished: sorted.filter((m) => isFinished(m.status)).reverse(),
    };
  }, [matches]);
  if (!user) return null;
  if (canScore(user.role) && managesLeague(user, leagueId)) return <OrganizerHome g={g} role={user.role} />;
  if (user.role === 'club_manager' && user.club_id) return <ManagerHome clubId={user.club_id} g={g} heroId={heroId} />;
  if (user.role === 'player' && user.club_id) return <PlayerHome clubId={user.club_id} leagueId={leagueId} g={g} heroId={heroId} />;
  return <ViewerHome />;
}

type Groups = { live: Match[]; postponed: Match[]; pending: Match[]; finished: Match[] };

function MatchList({ items, prefix }: { items: Match[]; prefix: string }) {
  return (
    <View style={styles.list}>
      {items.map((m) => (
        <MatchCard key={m.match_id} m={m} testID={`${prefix}-${m.match_id}`} />
      ))}
    </View>
  );
}

function Note({ children, testID }: { children: React.ReactNode; testID?: string }) {
  return (
    <Text style={[text.muted, styles.note]} testID={testID}>
      {children}
    </Text>
  );
}

// ---------- League organizer / super admin ----------
// Live scoring sits in the hero card and fixtures sit in the tabs, so the panel only lists
// postponed matches that need a new date.
function OrganizerHome({ g, role }: { g: Groups; role: Parameters<typeof toolsCaption>[0] }) {
  return (
    <View testID="home-role-organizer">
      <ManagePanel title="Manage league" caption={toolsCaption(role)} testID="home-manage-league">
        <ManageSection first title={`Needs attention (${g.postponed.length})`} testID="home-attention">
          {g.postponed.length ? (
            g.postponed.map((m) => (
              <View key={m.match_id} style={styles.item} testID={`home-postponed-${m.match_id}`}>
                <View style={styles.itemHead}>
                  <Icon name={OFF_SCHEDULE.postponed!.icon} size={18} color={OFF_SCHEDULE.postponed!.color} />
                  <View style={{ flex: 1 }}>
                    <Text style={text.label} numberOfLines={2}>
                      {m.home_name} vs {m.away_name}
                    </Text>
                    <Text style={text.small}>Postponed. Was due {formatDateTime(m.scheduled_at)}.</Text>
                  </View>
                </View>
                <SecondaryButton
                  title="Reschedule"
                  icon="calendar-outline"
                  onPress={() => router.push(`/match/${m.match_id}?action=reschedule` as never)}
                  testID={`home-reschedule-${m.match_id}`}
                  accessibilityLabel={`Reschedule ${m.home_name} versus ${m.away_name}`}
                />
              </View>
            ))
          ) : (
            <View style={styles.itemHead} testID="home-attention-none">
              <Icon name="checkmark-circle" size={18} color={colors.success} />
              <Text style={[text.muted, { flex: 1 }]}>Nothing needs your attention.</Text>
            </View>
          )}
        </ManageSection>
      </ManagePanel>
    </View>
  );
}

// ---------- Club manager ----------
function ManagerHome({ clubId, g, heroId }: { clubId: string; g: Groups; heroId: string | null }) {
  const name = useClubNames();
  const roster = useCachedQuery<RosterState>(`roster:${clubId}`, `/api/v1/roster/${encodeURIComponent(clubId)}`);
  const club = name(clubId, 'Your club');
  const r = roster.data;
  const squad = r?.squad_id ? r.players.filter((p) => p.squad_id === r.squad_id).length : null;
  const max = r?.max_squad_size ?? null;
  const tw = r?.transfer_window ?? null;
  const today = localToday();
  const windowOpen = tw ? today >= tw.open && today <= tw.close : false;
  const next = g.live.find((m) => involves(m, clubId)) ?? g.pending.find((m) => involves(m, clubId));

  return (
    <View testID="home-role-manager">
      <ManagePanel title="Manage club" caption={toolsCaption('club_manager')} testID="home-manage-club">
        <View style={styles.clubRow}>
          <ClubCrest name={club} size={36} />
          <Text style={[text.title, { flex: 1 }]} numberOfLines={1} testID="home-club-name">
            {club}
          </Text>
        </View>
        {roster.loading && !r ? <Text style={text.muted}>Loading your squad…</Text> : null}
        {roster.error && !r ? <ErrorBanner message={roster.error} onRetry={roster.refresh} testID="home-club-error" /> : null}
        {r ? (
          <>
            <Row
              label="Squad size"
              testID="home-squad-size"
              value={squad == null ? 'No squad yet' : max ? `${squad} of ${max} players` : `${squad} player${squad === 1 ? '' : 's'}`}
            />
            <Row
              label="Transfer window"
              testID="home-transfer-window"
              value={
                tw ? (
                  <IconText
                    icon={windowOpen ? 'lock-open' : 'lock-closed'}
                    color={windowOpen ? colors.success : colors.warning}
                    label={`${windowOpen ? 'Open' : 'Closed'}, ${formatDay(tw.open)} to ${formatDay(tw.close)}`}
                  />
                ) : (
                  'Not set'
                )
              }
            />
          </>
        ) : null}
        <View style={styles.actions}>
          <PrimaryButton title="Manage roster" icon="people" onPress={() => router.push('/roster')} testID="home-manage-roster" style={styles.actionBtn} />
          <SecondaryButton title="Club store" icon="bag-outline" onPress={() => router.push('/store')} testID="home-club-store" style={styles.actionBtn} />
        </View>
      </ManagePanel>
      <ClubNext next={next} heroId={heroId} prefix="home-club-next" />
    </View>
  );
}

// ---------- Player ----------
function PlayerHome({ clubId, leagueId, g, heroId }: { clubId: string; leagueId: string | null; g: Groups; heroId: string | null }) {
  const name = useClubNames();
  const st = useCachedQuery<Standings>(leagueId ? `standings:${leagueId}` : null, leagueId ? `/audit/v1/standings/${encodeURIComponent(leagueId)}` : null);
  const club = name(clubId, 'Your club');
  const next = g.live.find((m) => involves(m, clubId)) ?? g.pending.find((m) => involves(m, clubId));
  const last = g.finished.find((m) => m.status === 'completed' && involves(m, clubId));
  const table = st.data?.table ?? [];
  const row = table.find((t) => t.team_id === clubId);

  let result: React.ReactNode = 'No results yet';
  if (last) {
    const home = last.home_team_id === clubId;
    const us = home ? last.home_score : last.away_score;
    const them = home ? last.away_score : last.home_score;
    const opp = home ? last.away_name : last.home_name;
    const r = us > them ? { w: 'Won', icon: 'checkmark-circle' as IconName, c: colors.success } : us < them ? { w: 'Lost', icon: 'close-circle' as IconName, c: colors.danger } : { w: 'Drew', icon: 'remove-circle' as IconName, c: colors.textMuted };
    result = <IconText icon={r.icon} color={r.c} label={`${r.w} ${us} : ${them} vs ${opp}`} />;
  }

  return (
    <View testID="home-role-player">
      <SectionTitle>Your club</SectionTitle>
      <View style={styles.card} testID="home-player-club">
        <View style={styles.clubRow}>
          <ClubCrest name={club} size={36} />
          <Text style={[text.title, { flex: 1 }]} numberOfLines={1}>
            {club}
          </Text>
        </View>
        <Row
          label="League position"
          testID="home-player-position"
          value={row ? `${ordinal(row.rank)} of ${table.length}, ${row.points} pts` : st.loading ? 'Loading…' : 'Not in the table yet'}
        />
        <Row label="Last result" testID="home-player-last" value={result} />
      </View>
      <ClubNext next={next} heroId={heroId} prefix="home-player-next" />
    </View>
  );
}

// The club's next (or live) match, unless the hero card above already shows it.
function ClubNext({ next, heroId, prefix }: { next: Match | undefined; heroId: string | null; prefix: string }) {
  if (next && next.match_id === heroId) return null;
  return (
    <>
      <SectionTitle>{next?.status === 'in_progress' ? 'Your club is playing now' : 'Your next match'}</SectionTitle>
      {next ? <MatchList items={[next]} prefix={prefix} /> : <Note testID={`${prefix}-none`}>No upcoming matches for your club yet.</Note>}
    </>
  );
}

// ---------- Viewer (and any other role) ----------
// Live matches and results are covered by the hero card and the fixtures tabs.
function ViewerHome() {
  return (
    <View testID="home-role-viewer">
      <PressableCard testID="home-viewer-standings" label="Open the league table" onPress={() => router.push('/standings')} style={styles.shortcut}>
        <Icon name="podium" size={22} color={colors.accent} />
        <View style={{ flex: 1 }}>
          <Text style={text.label}>League table</Text>
          <Text style={text.small}>Points, positions and qualification</Text>
        </View>
        <Icon name="chevron-forward" size={18} color={colors.textMuted} />
      </PressableCard>
    </View>
  );
}

function IconText({ icon, color, label }: { icon: IconName; color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}>
      <Icon name={icon} size={16} color={color} />
      <Text style={[text.label, { flexShrink: 1, textAlign: 'right' }]}>{label}</Text>
    </View>
  );
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

const styles = StyleSheet.create({
  list: { backgroundColor: colors.card, borderRadius: 20, overflow: 'hidden', marginBottom: spacing.md },
  note: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.md },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.md },
  item: { gap: spacing.sm, marginBottom: spacing.md },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  clubRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  actionBtn: { flexGrow: 1, minWidth: 140 },
  shortcut: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 64 },
});
