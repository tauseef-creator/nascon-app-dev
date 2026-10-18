import { Icon } from '../../src/components/Icon';
import { randomUUID } from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../../src/api/client';
import { errorText, toAppError } from '../../src/api/errors';
import { Match, MatchStatus, MatchStatusInfo, Product, ScoreProjection, TimelineEvent } from '../../src/api/types';
import { canPin, managesLeague, useAuth, useBrand } from '../../src/auth/AuthContext';
import { ConfirmDialog } from '../../src/components/ConfirmDialog';
import { ManagePanel, ManageSection, toolsCaption } from '../../src/components/ManagePanel';
import { Screen } from '../../src/components/Screen';
import { useToast } from '../../src/components/Toast';
import {
  CachedNotice,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  formatDateTime,
  InfoBanner,
  LoadingView,
  matchPill,
  money,
  PrimaryButton,
  SecondaryButton,
  SectionTitle,
  Sheen,
  StatusPill,
} from '../../src/components/ui';
import { useCachedQuery } from '../../src/hooks/useCachedQuery';
import { humanize, useClubNames } from '../../src/hooks/useClubNames';
import { useLiveMatch } from '../../src/hooks/useLiveMatch';
import { readCache, writeCache } from '../../src/offline/cache';
import { listQueue, QueuedAction, subscribeQueue } from '../../src/offline/queue';
import { useSync } from '../../src/offline/SyncProvider';
import { colors, radius, spacing, surface, text, TOUCH, type } from '../../src/theme';
import { ClubCrest, crestColor } from '../../src/components/ClubCrest';
import { ProductArt } from '../../src/components/ProductArt';
import { MatchLiveVideo } from '../../src/components/MatchLiveVideo';
import { LinearGradient } from 'expo-linear-gradient';
import { frozenMessage, isFrozen, OFF_SCHEDULE, statusLabel } from '../../src/utils/matchStatus';
import { QrCard } from '../../src/components/QrCard';
import { useNotify } from '../../src/realtime/NotificationProvider';

type StatusAction = 'postponed' | 'upcoming' | 'cancelled' | 'abandoned';

const STATUS_COPY: Record<StatusAction, { title: string; message: string; confirm: string; cancel: string; success: string; destructive?: boolean }> = {
  postponed: {
    title: 'Postpone this match?',
    message: 'Scoring is paused until you set a new date. Everyone following the match will see it as postponed.',
    confirm: 'Postpone match',
    cancel: 'Go back',
    success: 'Match postponed.',
  },
  upcoming: {
    title: 'Reschedule this match',
    message: 'Choose the new kick-off date and time. The match becomes upcoming again.',
    confirm: 'Save new date',
    cancel: 'Go back',
    success: 'Match rescheduled.',
  },
  cancelled: {
    title: 'Cancel this match?',
    message: 'The match will not be played and scoring closes. This cannot be undone.',
    confirm: 'Cancel match',
    cancel: 'Keep match',
    success: 'Match cancelled.',
    destructive: true,
  },
  abandoned: {
    title: 'Abandon this match?',
    message: 'Play stops now and the current score is kept. Scoring closes and this cannot be undone.',
    confirm: 'Abandon match',
    cancel: 'Keep playing',
    success: 'Match abandoned.',
    destructive: true,
  },
};

const STATUS_OFFLINE = 'Changing the match status needs a connection, so nothing was saved. Reconnect and try again.';

const pad = (n: number) => String(n).padStart(2, '0');
/** Local YYYY-MM-DD and HH:MM for an ISO time (defaults to tomorrow at the same time if it has passed). */
function localParts(iso: string | null | undefined): { date: string; time: string } {
  let d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) d = new Date();
  if (d.getTime() < Date.now()) {
    const t = new Date(Date.now() + 24 * 3600 * 1000);
    t.setHours(d.getHours(), d.getMinutes(), 0, 0);
    d = t;
  }
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** Parses the reschedule inputs; returns the Date or a plain-language problem. */
function parseWhen(date: string, time: string): Date | string {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!dm) return 'Enter the date as YYYY-MM-DD, for example 2026-10-30.';
  const tm = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!tm) return 'Enter the time as HH:MM in 24-hour format, for example 18:30.';
  const [y, mo, d] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
  const when = new Date(y, mo - 1, d, Number(tm[1]), Number(tm[2]), 0, 0);
  if (when.getFullYear() !== y || when.getMonth() !== mo - 1 || when.getDate() !== d) return 'That date does not exist. Check the day and month.';
  if (when.getTime() <= Date.now()) return 'Choose a date and time in the future.';
  return when;
}

type Pending = { action: string; title: string; message: string; destructive?: boolean; run: () => Promise<void> };

export default function MatchDetail() {
  const { id, action } = useLocalSearchParams<{ id: string; action?: string }>();
  const { user } = useAuth();
  const brand = useBrand();
  const toast = useToast();
  const sync = useSync();
  const name = useClubNames();
  const score = useCachedQuery<ScoreProjection>(id ? `score:${id}` : null, id ? `/audit/v1/score/${encodeURIComponent(id)}` : null);
  // Scoring and status tools only for the organizer of this match's league (or the super admin).
  const scorer = managesLeague(user, score.data?.league_id);
  const pinned = useCachedQuery<{ product: Product | null }>(id ? `pinned:${id}` : null, id ? `/api/v1/matches/${encodeURIComponent(id)}/pinned` : null);
  const status = useCachedQuery<MatchStatusInfo>(id ? `status:${id}` : null, id ? `/api/v1/matches/${encodeURIComponent(id)}/status` : null);
  const sportId = score.data?.sport_id ?? null;
  const sport = useCachedQuery<{ sport_id: string; config: any }>(
    scorer && sportId ? `sport:${sportId}` : null,
    scorer && sportId ? `/api/v1/sports/${encodeURIComponent(sportId)}` : null,
  );

  // Basic match info (names, venue, time) from the cached fixtures list.
  const [info, setInfo] = useState<Match | null>(null);
  useEffect(() => {
    const lg = score.data?.league_id;
    if (!lg) return;
    readCache<{ matches: Match[] }>(`matches:${lg}`)
      .then((c) => setInfo(c?.data?.matches?.find((m) => m.match_id === id) ?? null))
      .catch(() => {});
  }, [score.data?.league_id, id]);

  const [queued, setQueued] = useState<QueuedAction[]>([]);
  const loadQueued = useCallback(() => {
    listQueue()
      .then((all) => setQueued(all.filter((a) => a.type === 'score_event' && a.payload?.match_id === id)))
      .catch(() => {});
  }, [id]);
  useEffect(() => {
    loadQueued();
    return subscribeQueue(loadQueued);
  }, [loadQueued]);

  // Keep this match's score notifications coming after the user leaves the screen (FR-5.2).
  const { watchMatch } = useNotify();
  useEffect(() => {
    if (id) watchMatch(id);
  }, [id, watchMatch]);

  const live = useLiveMatch(id, sync.online, {
    onScore: (p) => {
      score.setData(p);
      if (id) writeCache(`score:${id}`, p).catch(() => {});
      // Start or end of play changes the effective status too.
      if (status.data && status.data.log_status !== p.status) status.reload();
    },
    onPinned: () => pinned.reload(),
    onStatus: (st: MatchStatusInfo) => {
      status.setData(st);
      if (id) writeCache(`status:${id}`, st).catch(() => {});
      score.reload();
    },
    poll: () => {
      score.reload();
      status.reload();
    },
  });

  const [confirm, setConfirm] = useState<Pending | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [undoTarget, setUndoTarget] = useState<TimelineEvent | null>(null);
  const [undoReason, setUndoReason] = useState('Scoring mistake');
  const [pinOpen, setPinOpen] = useState(false);
  const [statusAction, setStatusAction] = useState<StatusAction | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const s = score.data;
  const homeName = name(s?.home.team_id, info?.home_name ?? 'Home');
  const awayName = name(s?.away.team_id, info?.away_name ?? 'Away');
  const teamName = (tid: string) => (tid === s?.home.team_id ? homeName : tid === s?.away.team_id ? awayName : name(tid));
  const scoringKeys: string[] = useMemo(() => Object.keys(sport.data?.config?.scoring_events ?? {}), [sport.data]);

  const send = async (body: any, label: string, successMsg: string) => {
    setActionError(null);
    setBusy(label);
    try {
      const r = await sync.submitOrQueue({
        type: 'score_event',
        path: '/audit/v1/events',
        body,
        baseVersion: s?.version ?? 0,
        label,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (r.queued) toast('Saved on this phone. It will sync when you are back online.', 'info');
      else {
        toast(successMsg);
        score.reload();
        status.reload();
      }
    } catch (e) {
      const msg = errorText(e);
      setActionError(msg);
      toast(msg, 'error');
    } finally {
      setBusy(null);
    }
  };

  const addScore = (teamId: string, eventType: string) => {
    if (!id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    send(
      { event_id: randomUUID(), match_id: id, type: 'score', payload: { team_id: teamId, event_type: eventType } },
      `${humanize(eventType)} for ${teamName(teamId)}`,
      `${humanize(eventType)} added for ${teamName(teamId)}.`,
    );
  };

  const lifecycle = (type: 'match_start' | 'match_end') => {
    if (!id) return;
    setConfirm({
      action: type,
      title: type === 'match_start' ? 'Start this match?' : 'End this match?',
      message:
        type === 'match_start'
          ? `${homeName} vs ${awayName} will go live and scores can be added.`
          : 'The result becomes final and no more scores can be added.',
      destructive: type === 'match_end',
      run: () =>
        send(
          { event_id: randomUUID(), match_id: id, type, payload: {} },
          type === 'match_start' ? 'Start match' : 'End match',
          type === 'match_start' ? 'Match started.' : 'Match ended.',
        ),
    });
  };

  const doUndo = async () => {
    if (!undoTarget || !id) return;
    const target = undoTarget;
    setUndoTarget(null);
    await send(
      {
        event_id: randomUUID(),
        match_id: id,
        type: 'compensation',
        payload: { compensates: target.event_id, reason: undoReason.trim() || 'Correction' },
      },
      `Undo: ${describe(target, teamName)}`,
      'The event was corrected.',
    );
  };

  const openStatus = useCallback(
    (a: StatusAction) => {
      setStatusErr(null);
      if (a === 'upcoming') {
        const p = localParts(status.data?.scheduled_at ?? info?.scheduled_at);
        setNewDate(p.date);
        setNewTime(p.time);
      }
      setStatusAction(a);
    },
    [status.data?.scheduled_at, info?.scheduled_at],
  );

  // Home > Needs attention > Reschedule opens the reschedule form directly.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || action !== 'reschedule' || !scorer || !status.data) return;
    autoOpened.current = true;
    if (status.data.allowed_transitions.includes('upcoming')) openStatus('upcoming');
  }, [action, scorer, status.data, openStatus]);

  const submitStatus = async () => {
    if (!id || !statusAction) return;
    let when: Date | null = null;
    if (statusAction === 'upcoming') {
      const w = parseWhen(newDate, newTime);
      if (typeof w === 'string') return setStatusErr(w);
      when = w;
    }
    if (!sync.online) return setStatusErr(STATUS_OFFLINE);
    setStatusErr(null);
    setStatusBusy(true);
    try {
      const body: Record<string, string> = { status: statusAction };
      if (when) body.scheduled_at = when.toISOString();
      const r = await api<MatchStatusInfo>(`/api/v1/matches/${encodeURIComponent(id)}/status`, { method: 'POST', body });
      status.setData(r);
      writeCache(`status:${id}`, r).catch(() => {});
      const done = STATUS_COPY[statusAction].success;
      setStatusAction(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast(when ? `${done} New kick-off: ${formatDateTime(r.scheduled_at ?? when.toISOString())}.` : done);
      score.reload();
    } catch (e) {
      const err = toAppError(e);
      setStatusErr(err.isNetwork ? STATUS_OFFLINE : err.message);
      if (err.code === 'ILLEGAL_TRANSITION') status.reload();
    } finally {
      setStatusBusy(false);
    }
  };

  const events = s?.events ?? [];
  const lastUndoable = [...events].reverse().find((e) => e.type === 'score' && !e.compensated);

  if (score.loading && !s) {
    return (
      <Screen title="Match" back testID="match-screen">
        <LoadingView label="Loading match…" />
      </Screen>
    );
  }
  if (!s) {
    return (
      <Screen title="Match" back testID="match-screen">
        <ErrorBanner message={score.error ?? "We couldn't load this match."} onRetry={score.refresh} testID="match-error" />
      </Screen>
    );
  }

  // Effective status: the FR-1.3 status endpoint wins, then the fixtures list, then the event log.
  const eff: MatchStatus = status.data?.status ?? info?.status ?? s.status;
  const frozen = isFrozen(eff);
  const off = OFF_SCHEDULE[eff];
  const isLive = eff === 'in_progress';
  const kickoff = status.data?.scheduled_at ?? info?.scheduled_at ?? null;
  const allowed = (status.data?.allowed_transitions ?? []) as StatusAction[];
  const showManage = scorer || canPin(user?.role);
  const liveText =
    !sync.online ? 'Offline: showing the last saved score' : live === 'live' ? 'Live updates on' : live === 'polling' ? 'Refreshing every 5 seconds' : 'Connecting to live updates…';

  return (
    <Screen title={`${homeName} vs ${awayName}`} subtitle={info?.venue ?? undefined} back onRefresh={score.refresh} refreshing={score.refreshing} testID="match-screen">
      {score.fromCache && score.updatedAt ? <CachedNotice updatedAt={score.updatedAt} /> : null}
      {!user ? (
        <View style={{ marginBottom: spacing.md }}>
          <InfoBanner message="You are watching as a guest. Sign in to buy merchandise or chat." testID="match-guest" />
          <SecondaryButton title="Sign in" icon="log-in-outline" onPress={() => router.push('/login')} testID="match-guest-signin" />
        </View>
      ) : null}

      <Card testID="score-header" style={{ padding: 0, overflow: 'hidden', borderRadius: 26 }}>
        <LinearGradient
          colors={[crestColor(homeName), '#1C1C1E', crestColor(awayName)]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          locations={[0, 0.5, 1]}
        >
          <View style={{ backgroundColor: 'rgba(0, 0, 0, 0.48)', padding: spacing.lg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }}>
          <StatusPill kind={matchPill(eff)} label={frozen ? statusLabel(eff).toUpperCase() : undefined} testID="match-status" />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}>
            <Icon name={live === 'live' ? 'pulse' : sync.online ? 'refresh' : 'cloud-offline-outline'} size={16} color={colors.textMuted} />
            <Text style={text.small} testID="live-mode">
              {liveText}
            </Text>
          </View>
        </View>
        <Text style={{ color: '#E5E5E7', fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 0.8, textAlign: 'center', marginTop: spacing.xl }} numberOfLines={1}>{info?.venue ?? 'MATCH CENTRE'}</Text>
        <View style={styles.scoreRow} accessible accessibilityLabel={`${homeName} ${s.home.score}, ${awayName} ${s.away.score}`}>
          <View style={styles.side}>
            <Text style={[styles.scoreNum, s.away.score > s.home.score && styles.scoreDim]} testID="score-home">
              {s.home.score}
            </Text>
            <View style={styles.crest}><ClubCrest name={homeName} size={44} /></View>
            <Text style={styles.teamName} numberOfLines={2}>
              {homeName}
            </Text>
            <Text style={styles.sideNote}>Home</Text>
          </View>
          <Text style={styles.dash}>{isLive ? 'Live' : eff === 'completed' ? 'Final' : frozen ? statusLabel(eff) : 'vs'}</Text>
          <View style={styles.side}>
            <Text style={[styles.scoreNum, s.home.score > s.away.score && styles.scoreDim]} testID="score-away">
              {s.away.score}
            </Text>
            <View style={styles.crest}><ClubCrest name={awayName} size={44} /></View>
            <Text style={styles.teamName} numberOfLines={2}>
              {awayName}
            </Text>
            <Text style={styles.sideNote}>Away</Text>
          </View>
        </View>
        {eff === 'completed' ? (
          <Text style={[text.label, { textAlign: 'center' }]} testID="match-outcome">
            {s.winner_team_id ? `${teamName(s.winner_team_id)} won` : s.outcome === 'draw' ? 'Draw' : 'Full time'}
          </Text>
        ) : null}
        {(eff === 'upcoming' || eff === 'postponed') && kickoff ? (
          <Text style={[text.small, { textAlign: 'center', color: '#E5E5E7' }]} testID="match-kickoff">
            {eff === 'postponed' ? `Was due ${formatDateTime(kickoff)}. New date to be confirmed.` : `Kick-off ${formatDateTime(kickoff)}`}
          </Text>
        ) : null}

          </View>
        </LinearGradient>
        <Sheen radius={26} height="35%" />
      </Card>

      {isLive ? <MatchLiveVideo matchId={String(id)} /> : null}

      <View style={{ flexDirection: 'row', backgroundColor: surface.glass, borderWidth: StyleSheet.hairlineWidth, borderColor: surface.edge, borderRadius: 20, paddingVertical: spacing.md, marginBottom: spacing.md }} testID="match-summary">
        <View style={{ flex: 1, alignItems: 'center' }}><Text style={{ ...type.score, fontSize: 22, lineHeight: 26, color: colors.white }}>{events.filter((e) => e.type === 'score' && !e.compensated).length}</Text><Text style={{ ...type.overline, fontSize: 10, letterSpacing: 0.7, color: colors.textMuted, marginTop: 2 }}>SCORES</Text></View>
        <View style={{ width: 1, backgroundColor: colors.divider }} />
        <View style={{ flex: 1, alignItems: 'center' }}><Text style={{ ...type.score, fontSize: 22, lineHeight: 26, color: colors.white }}>{events.length}</Text><Text style={{ ...type.overline, fontSize: 10, letterSpacing: 0.7, color: colors.textMuted, marginTop: 2 }}>PLAYS</Text></View>
        <View style={{ width: 1, backgroundColor: colors.divider }} />
        <View style={{ flex: 1, alignItems: 'center' }}><Icon name={isLive ? 'radio' : off ? off.icon : 'time-outline'} size={21} color={isLive ? colors.live : off ? off.color : colors.accent} /><Text style={{ ...type.overline, fontSize: 10, letterSpacing: 0.7, color: colors.textMuted, marginTop: 2 }}>{isLive ? 'LIVE' : eff === 'completed' ? 'FINAL' : statusLabel(eff).toUpperCase()}</Text></View>
      </View>

      {frozen ? (
        <InfoBanner
          testID="match-frozen"
          tone="warning"
          icon={off?.icon ?? 'pause-circle'}
          message={frozenMessage(eff)}
        />
      ) : null}

      {pinned.data?.product ? <PinnedCard product={pinned.data.product} /> : null}

      {showManage ? (
        <ManagePanel title="Manage match" caption={toolsCaption(user?.role)} testID="manage-match">
          {scorer ? (
            <ManageSection first title="Scoring" testID="scoring-panel">
              {frozen ? (
                <Text style={text.muted} testID="scoring-paused">
                  {frozenMessage(eff)}
                </Text>
              ) : (
                <>
                  <Text style={[text.muted, { marginBottom: spacing.md }]}>
                    {isLive
                      ? 'Tap a button to add a score. Every action is recorded and can be corrected.'
                      : eff === 'completed'
                        ? 'This match has ended. Scores can no longer be added.'
                        : 'Start the match to begin adding scores.'}
                  </Text>
                  {actionError ? <ErrorBanner message={actionError} testID="scoring-error" /> : null}
                  {eff === 'upcoming' ? (
                    <PrimaryButton title="Start match" icon="play" onPress={() => lifecycle('match_start')} loading={busy === 'Start match'} testID="score-start" />
                  ) : null}
                  {isLive ? (
                    <>
                      {sport.loading && !scoringKeys.length ? <LoadingView label="Loading scoring options…" /> : null}
                      {sport.error && !scoringKeys.length ? <ErrorBanner message={sport.error} onRetry={sport.refresh} /> : null}
                      <View style={styles.scoreGrid}>
                        {[s.home.team_id, s.away.team_id].map((tid) => (
                          <View key={tid} style={styles.scoreCol}>
                            <Text style={[text.label, { marginBottom: spacing.sm }]} numberOfLines={2}>
                              {teamName(tid)}
                            </Text>
                            {scoringKeys.map((k) => (
                              <PrimaryButton
                                key={k}
                                title={`+ ${humanize(k)}`}
                                accessibilityLabel={`Add ${humanize(k)} for ${teamName(tid)}`}
                                onPress={() => addScore(tid, k)}
                                disabled={!!busy}
                                testID={`score-add-${tid === s.home.team_id ? 'home' : 'away'}-${k}`}
                                style={{ marginBottom: spacing.sm }}
                              />
                            ))}
                          </View>
                        ))}
                      </View>
                      <View style={{ gap: spacing.sm }}>
                        <SecondaryButton
                          title="Undo last score"
                          icon="arrow-undo"
                          disabled={!lastUndoable || !!busy}
                          onPress={() => lastUndoable && setUndoTarget(lastUndoable)}
                          testID="score-undo-last"
                        />
                        <SecondaryButton title="End match" icon="stop-circle-outline" danger onPress={() => lifecycle('match_end')} disabled={!!busy} testID="score-end" />
                      </View>
                    </>
                  ) : null}
                </>
              )}
            </ManageSection>
          ) : null}
          {canPin(user?.role) ? (
            <ManageSection first={!scorer} title="Featured product" testID="pin-section">
              <SecondaryButton
                title={pinned.data?.product ? 'Change pinned product' : 'Pin a product'}
                icon="pricetag-outline"
                onPress={() => (sync.online ? setPinOpen(true) : toast('Pinning a product needs a connection.', 'error'))}
                testID="pin-open"
              />
            </ManageSection>
          ) : null}
          {scorer ? (
            <ManageSection title="Match status" testID="status-panel">
              <Text style={[text.small, { marginBottom: spacing.sm }]} testID="status-current">
                Current status: {statusLabel(eff)}
              </Text>
              {!sync.online ? (
                <InfoBanner
                  testID="status-offline"
                  tone="warning"
                  icon="cloud-offline-outline"
                  message="You're offline. Postponing, rescheduling, cancelling or abandoning a match needs a connection and is not saved for later."
                />
              ) : null}
              {status.loading && !status.data ? <Text style={text.muted}>Loading status options…</Text> : null}
              {status.error && !status.data ? <ErrorBanner message={status.error} onRetry={status.refresh} testID="status-error" /> : null}
              {status.data ? (
                allowed.length ? (
                  <View style={{ gap: spacing.sm }}>
                    {allowed.includes('upcoming') ? (
                      <PrimaryButton title="Reschedule" icon="calendar-outline" onPress={() => openStatus('upcoming')} disabled={!sync.online || statusBusy} testID="status-reschedule" accessibilityHint="Set a new kick-off date and time" />
                    ) : null}
                    {allowed.includes('postponed') ? (
                      <SecondaryButton title="Postpone match" icon="pause-circle-outline" onPress={() => openStatus('postponed')} disabled={!sync.online || statusBusy} testID="status-postpone" />
                    ) : null}
                    {allowed.includes('abandoned') ? (
                      <SecondaryButton title="Abandon match" icon="alert-circle-outline" danger onPress={() => openStatus('abandoned')} disabled={!sync.online || statusBusy} testID="status-abandon" />
                    ) : null}
                    {allowed.includes('cancelled') ? (
                      <SecondaryButton title="Cancel match" icon="close-circle-outline" danger onPress={() => openStatus('cancelled')} disabled={!sync.online || statusBusy} testID="status-cancel" />
                    ) : null}
                  </View>
                ) : (
                  <Text style={text.muted} testID="status-final">
                    {eff === 'completed' ? 'This match is complete, so its status can no longer change.' : `This match is ${statusLabel(eff).toLowerCase()}. This is final.`}
                  </Text>
                )
              ) : null}
            </ManageSection>
          ) : null}
        </ManagePanel>
      ) : null}

      {queued.length ? (
        <>
          <SectionTitle>Waiting to sync ({queued.length})</SectionTitle>
          {queued.map((a) => (
            <Card key={a.action_id} testID={`pending-${a.action_id}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
                <Text style={[text.label, { flex: 1 }]}>{a.label}</Text>
                <StatusPill kind="pending" />
              </View>
              <Text style={text.small}>Saved on this phone. It will be sent automatically when you are online.</Text>
            </Card>
          ))}
        </>
      ) : null}

      <SectionTitle>Play-by-play</SectionTitle>
      {events.length === 0 ? (
        <EmptyState icon="time-outline" title="No events yet" message={isLive ? 'Scores will appear here as they happen.' : 'Events will appear here once the match starts.'} testID="timeline-empty" />
      ) : (
        <Card testID="timeline">
          {[...events].reverse().map((e, i, arr) => (
            <TimelineRow
              key={e.event_id}
              e={e}
              last={i === arr.length - 1}
              teamName={teamName}
              events={events}
              canUndo={scorer && isLive && !frozen && e.type === 'score' && !e.compensated}
              onUndo={() => setUndoTarget(e)}
            />
          ))}
        </Card>
      )}

      {id ? <QrCard entityId={id} title="Share this match" /> : null}

      <ConfirmDialog
        visible={!!confirm}
        title={confirm?.title ?? ''}
        message={confirm?.message}
        confirmTitle={confirm?.action === 'match_end' ? 'End match' : 'Start match'}
        destructive={confirm?.destructive}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          c?.run();
        }}
      />
      <ConfirmDialog
        visible={!!undoTarget}
        title="Undo this event?"
        message={undoTarget ? `"${describe(undoTarget, teamName)}" will be cancelled and the score recalculated. The original stays in the timeline, marked as corrected.` : ''}
        confirmTitle="Undo event"
        destructive
        onCancel={() => setUndoTarget(null)}
        onConfirm={doUndo}
        testID="undo-dialog"
      >
        <Text style={[text.label, { marginBottom: spacing.xs }]}>Reason</Text>
        <TextInput
          testID="undo-reason"
          accessibilityLabel="Reason for the correction"
          value={undoReason}
          onChangeText={setUndoReason}
          style={styles.input}
        />
      </ConfirmDialog>
      <ConfirmDialog
        visible={!!statusAction}
        title={statusAction ? STATUS_COPY[statusAction].title : ''}
        message={statusAction ? STATUS_COPY[statusAction].message : undefined}
        confirmTitle={statusAction ? STATUS_COPY[statusAction].confirm : 'Confirm'}
        cancelTitle={statusAction ? STATUS_COPY[statusAction].cancel : 'Cancel'}
        destructive={statusAction ? STATUS_COPY[statusAction].destructive : false}
        loading={statusBusy}
        onCancel={() => setStatusAction(null)}
        onConfirm={submitStatus}
        testID="status-dialog"
      >
        {statusAction === 'upcoming' ? (
          <>
            <Field
              label="New date (YYYY-MM-DD)"
              testID="status-date"
              value={newDate}
              onChangeText={setNewDate}
              keyboardType="numbers-and-punctuation"
              autoCorrect={false}
              placeholder="2026-10-30"
            />
            <Field
              label="Kick-off time (24-hour HH:MM)"
              testID="status-time"
              value={newTime}
              onChangeText={setNewTime}
              keyboardType="numbers-and-punctuation"
              autoCorrect={false}
              placeholder="18:30"
            />
          </>
        ) : null}
        {!sync.online ? <InfoBanner tone="warning" icon="cloud-offline-outline" message="You're offline. This change needs a connection and will not be saved for later." /> : null}
        {statusErr ? <ErrorBanner message={statusErr} testID="status-dialog-error" /> : null}
      </ConfirmDialog>
      <PinPicker
        visible={pinOpen}
        matchId={id!}
        current={pinned.data?.product?.product_id}
        onClose={() => setPinOpen(false)}
        onPinned={(p) => {
          setPinOpen(false);
          pinned.setData({ product: p });
          toast(`${p.name} is now pinned to this match.`);
          pinned.reload();
        }}
      />
    </Screen>
  );
}

function describe(e: TimelineEvent, teamName: (id: string) => string): string {
  if (e.type === 'score') return `${humanize(e.payload?.event_type)}: ${teamName(e.payload?.team_id)}`;
  if (e.type === 'match_start') return 'Match started';
  if (e.type === 'match_end') return 'Match ended';
  if (e.type === 'compensation') return 'Correction';
  return humanize(e.type);
}

function TimelineRow({
  e,
  last,
  teamName,
  events,
  canUndo,
  onUndo,
}: {
  e: TimelineEvent;
  last: boolean;
  teamName: (id: string) => string;
  events: TimelineEvent[];
  canUndo: boolean;
  onUndo: () => void;
}) {
  const icon: React.ComponentProps<typeof Icon>['name'] =
    e.type === 'score' ? 'add-circle' : e.type === 'compensation' ? 'arrow-undo-circle' : e.type === 'match_start' ? 'play-circle' : e.type === 'match_end' ? 'flag' : 'ellipse';
  let title = describe(e, teamName);
  if (e.type === 'compensation') {
    const t = events.find((x) => x.event_id === e.payload?.compensates);
    title = `Correction: cancelled #${t?.sequence ?? '?'}${t ? ` (${describe(t, teamName)})` : ''}`;
  }
  return (
    <View style={[styles.tl, !last && { borderBottomWidth: 1, borderBottomColor: colors.divider }]} testID={`timeline-${e.sequence}`}>
      <Icon name={icon} size={24} color={e.compensated ? colors.textMuted : colors.text} />
      <View style={{ flex: 1 }}>
        <Text
          style={[text.body, { fontFamily: 'Inter_600SemiBold' }, e.compensated && { textDecorationLine: 'line-through', color: colors.textMuted }]}
          accessibilityLabel={`${title}${e.compensated ? ', corrected' : ''}`}
        >
          #{e.sequence} {title}
        </Text>
        {e.type === 'compensation' && e.payload?.reason ? <Text style={text.small}>Reason: {e.payload.reason}</Text> : null}
        {e.compensated ? (
          <View style={{ marginTop: 4 }}>
            <StatusPill kind="corrected" label="CORRECTED" />
          </View>
        ) : null}
      </View>
      {canUndo ? (
        <Pressable
          testID={`timeline-undo-${e.sequence}`}
          accessibilityRole="button"
          accessibilityLabel={`Undo ${title}`}
          onPress={onUndo}
          style={styles.undoBtn}
        >
          <Icon name="arrow-undo" size={20} color={colors.danger} />
          <Text style={{ color: colors.danger, fontFamily: 'Inter_700Bold', fontSize: 15 }}>Undo</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function PinnedCard({ product }: { product: Product }) {
  const v = product.variants?.[0];
    return (
      <Card testID="pinned-product">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs }}>
        <Icon name="star" size={18} color={colors.warning} />
        <Text style={[text.section, { color: colors.warning }]}>Featured in this match</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm }}>
        <View style={{ width: 84, height: 84, borderRadius: 14, overflow: 'hidden' }}><ProductArt product={product} height={84} /></View>
        <View style={{ flex: 1 }}><Text style={text.title} numberOfLines={2}>{product.name}</Text>{v ? <Text style={[text.label, { marginTop: spacing.sm, fontSize: 17 }]}>{money(v.price_minor, v.currency)}</Text> : null}</View>
      </View>
      <PrimaryButton
        title="View and buy"
        icon="bag-add-outline"
        onPress={() => router.push(`/product/${product.product_id}`)}
        testID="pinned-buy"
        style={{ marginTop: spacing.md }}
      />
    </Card>
  );
}

function PinPicker({
  visible,
  matchId,
  current,
  onClose,
  onPinned,
}: {
  visible: boolean;
  matchId: string;
  current?: string;
  onClose: () => void;
  onPinned: (p: Product) => void;
}) {
  const products = useCachedQuery<{ products: Product[] }>(visible ? 'products' : null, visible ? '/api/v1/products' : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pin = async (p: Product) => {
    setBusy(p.product_id);
    setErr(null);
    try {
      await api(`/api/v1/matches/${encodeURIComponent(matchId)}/pin`, { method: 'POST', body: { product_id: p.product_id } });
      onPinned(p);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheet} testID="pin-picker">
          <Text style={[text.title, { marginBottom: spacing.md }]} accessibilityRole="header">
            Pin a product to this match
          </Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {err ? <ErrorBanner message={err} /> : null}
            {products.loading ? <LoadingView label="Loading products…" /> : null}
            {products.error && !products.data ? <ErrorBanner message={products.error} onRetry={products.refresh} /> : null}
            {products.data && !products.data.products.length ? <InfoBanner message="There are no products in the store yet." /> : null}
            {(products.data?.products ?? []).map((p) => (
              <SecondaryButton
                key={p.product_id}
                title={p.product_id === current ? `${p.name} (pinned)` : p.name}
                icon={p.product_id === current ? 'checkmark-circle' : 'pricetag-outline'}
                onPress={() => pin(p)}
                loading={busy === p.product_id}
                disabled={!!busy}
                testID={`pin-product-${p.product_id}`}
                style={{ marginBottom: spacing.sm }}
              />
            ))}
          </ScrollView>
          <SecondaryButton title="Close" onPress={onClose} testID="pin-close" style={{ marginTop: spacing.sm }} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  crest: { marginTop: spacing.xs, marginBottom: 6 },
  scoreDim: { color: 'rgba(255,255,255,0.55)' },
  sideNote: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 2 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: spacing.lg, gap: 4 },
  side: { flex: 1, alignItems: 'center' },
  teamName: { fontSize: 15, lineHeight: 20, fontFamily: 'Inter_700Bold', letterSpacing: -0.2, color: colors.text, textAlign: 'center' },
  scoreNum: { fontSize: 68, fontFamily: 'Inter_800ExtraBold', lineHeight: 74, letterSpacing: -3, color: colors.text, fontVariant: ['tabular-nums'], minWidth: 40, textAlign: 'center' },
  dash: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textMuted, paddingHorizontal: 2 },
  scoreGrid: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm },
  scoreCol: { flex: 1 },
  tl: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, minHeight: TOUCH },
  undoBtn: { minHeight: TOUCH, minWidth: TOUCH, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm },
  input: {
    minHeight: TOUCH,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.cardHi,
  },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, maxHeight: '90%' },
});
