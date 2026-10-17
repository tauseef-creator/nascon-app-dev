import { Ionicons } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../../src/api/client';
import { errorText } from '../../src/api/errors';
import { Match, Product, ScoreProjection, TimelineEvent } from '../../src/api/types';
import { canPin, canScore, useAuth, useBrand } from '../../src/auth/AuthContext';
import { ConfirmDialog } from '../../src/components/ConfirmDialog';
import { Screen } from '../../src/components/Screen';
import { useToast } from '../../src/components/Toast';
import {
  CachedNotice,
  Card,
  EmptyState,
  ErrorBanner,
  InfoBanner,
  LoadingView,
  matchPill,
  money,
  PrimaryButton,
  SecondaryButton,
  SectionTitle,
  StatusPill,
} from '../../src/components/ui';
import { useCachedQuery } from '../../src/hooks/useCachedQuery';
import { humanize, useClubNames } from '../../src/hooks/useClubNames';
import { useLiveMatch } from '../../src/hooks/useLiveMatch';
import { readCache, writeCache } from '../../src/offline/cache';
import { listQueue, QueuedAction, subscribeQueue } from '../../src/offline/queue';
import { useSync } from '../../src/offline/SyncProvider';
import { colors, radius, spacing, text, TOUCH } from '../../src/theme';
import { ClubCrest, crestColor } from '../../src/components/ClubCrest';
import { LinearGradient } from 'expo-linear-gradient';

type Pending = { action: string; title: string; message: string; destructive?: boolean; run: () => Promise<void> };

export default function MatchDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const brand = useBrand();
  const toast = useToast();
  const sync = useSync();
  const name = useClubNames();
  const scorer = canScore(user?.role);

  const score = useCachedQuery<ScoreProjection>(id ? `score:${id}` : null, id ? `/audit/v1/score/${encodeURIComponent(id)}` : null);
  const pinned = useCachedQuery<{ product: Product | null }>(id ? `pinned:${id}` : null, id ? `/api/v1/matches/${encodeURIComponent(id)}/pinned` : null);
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
    readCache<{ matches: Match[] }>(`matches:${lg}`).then((c) => setInfo(c?.data.matches.find((m) => m.match_id === id) ?? null));
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

  const live = useLiveMatch(id, sync.online, {
    onScore: (p) => {
      score.setData(p);
      if (id) writeCache(`score:${id}`, p).catch(() => {});
    },
    onPinned: () => pinned.reload(),
    poll: () => score.reload(),
  });

  const [confirm, setConfirm] = useState<Pending | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [undoTarget, setUndoTarget] = useState<TimelineEvent | null>(null);
  const [undoReason, setUndoReason] = useState('Scoring mistake');
  const [pinOpen, setPinOpen] = useState(false);

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

  const events = s?.events ?? [];
  const lastUndoable = [...events].reverse().find((e) => e.type === 'score' && !e.compensated);

  if (score.loading && !s) {
    return (
      <Screen title="Match" back>
        <LoadingView label="Loading match…" />
      </Screen>
    );
  }
  if (!s) {
    return (
      <Screen title="Match" back>
        <ErrorBanner message={score.error ?? "We couldn't load this match."} onRetry={score.refresh} testID="match-error" />
      </Screen>
    );
  }

  const isLive = s.status === 'in_progress';
  const liveText =
    !sync.online ? 'Offline: showing the last saved score' : live === 'live' ? 'Live updates on' : live === 'polling' ? 'Refreshing every 5 seconds' : 'Connecting to live updates…';

  return (
    <Screen title={`${homeName} vs ${awayName}`} subtitle={info?.venue ?? undefined} back onRefresh={score.refresh} refreshing={score.refreshing} testID="match-screen">
      {score.fromCache && score.updatedAt ? <CachedNotice updatedAt={score.updatedAt} /> : null}

      <Card testID="score-header" style={{ padding: 0, overflow: 'hidden' }}>
        <LinearGradient
          colors={[crestColor(homeName), '#1C1C1E', crestColor(awayName)]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          locations={[0, 0.5, 1]}
        >
          <View style={{ backgroundColor: 'rgba(0, 0, 0, 0.35)', padding: spacing.lg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }}>
          <StatusPill kind={matchPill(s.status)} testID="match-status" />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}>
            <Ionicons name={live === 'live' ? 'pulse' : sync.online ? 'refresh' : 'cloud-offline-outline'} size={16} color={colors.textMuted} />
            <Text style={text.small} testID="live-mode">
              {liveText}
            </Text>
          </View>
        </View>
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
          <Text style={styles.dash}>{s.status === 'in_progress' ? 'Live' : s.status === 'completed' ? 'Final' : 'vs'}</Text>
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
        {s.status === 'completed' ? (
          <Text style={[text.label, { textAlign: 'center' }]} testID="match-outcome">
            {s.winner_team_id ? `${teamName(s.winner_team_id)} won` : s.outcome === 'draw' ? 'Draw' : 'Full time'}
          </Text>
        ) : null}
          </View>
        </LinearGradient>
      </Card>

      {pinned.data?.product ? <PinnedCard product={pinned.data.product} /> : null}

      {scorer ? (
        <Card testID="scoring-panel">
          <Text style={[text.title, { marginBottom: spacing.xs }]}>Scoring</Text>
          <Text style={[text.muted, { marginBottom: spacing.md }]}>
            {isLive
              ? 'Tap a button to add a score. Every action is recorded and can be corrected.'
              : s.status === 'completed'
                ? 'This match has ended. Scores can no longer be added.'
                : 'Start the match to begin adding scores.'}
          </Text>
          {actionError ? <ErrorBanner message={actionError} testID="scoring-error" /> : null}
          {s.status !== 'completed' && s.status !== 'in_progress' ? (
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
          {canPin(user?.role) ? (
            <SecondaryButton
              title={pinned.data?.product ? 'Change pinned product' : 'Pin a product'}
              icon="pricetag-outline"
              onPress={() => (sync.online ? setPinOpen(true) : toast('Pinning a product needs a connection.', 'error'))}
              testID="pin-open"
              style={{ marginTop: spacing.sm }}
            />
          ) : null}
        </Card>
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

      <SectionTitle>Timeline</SectionTitle>
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
              canUndo={scorer && isLive && e.type === 'score' && !e.compensated}
              onUndo={() => setUndoTarget(e)}
            />
          ))}
        </Card>
      )}

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
  const icon: React.ComponentProps<typeof Ionicons>['name'] =
    e.type === 'score' ? 'add-circle' : e.type === 'compensation' ? 'arrow-undo-circle' : e.type === 'match_start' ? 'play-circle' : e.type === 'match_end' ? 'flag' : 'ellipse';
  let title = describe(e, teamName);
  if (e.type === 'compensation') {
    const t = events.find((x) => x.event_id === e.payload?.compensates);
    title = `Correction: cancelled #${t?.sequence ?? '?'}${t ? ` (${describe(t, teamName)})` : ''}`;
  }
  return (
    <View style={[styles.tl, !last && { borderBottomWidth: 1, borderBottomColor: colors.divider }]} testID={`timeline-${e.sequence}`}>
      <Ionicons name={icon} size={24} color={e.compensated ? colors.textMuted : colors.text} />
      <View style={{ flex: 1 }}>
        <Text
          style={[text.body, { fontWeight: '600' }, e.compensated && { textDecorationLine: 'line-through', color: colors.textMuted }]}
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
          <Ionicons name="arrow-undo" size={20} color={colors.danger} />
          <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 15 }}>Undo</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function PinnedCard({ product }: { product: Product }) {
  const brand = useBrand();
  const v = product.variants?.[0];
    return (
      <Card testID="pinned-product">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs }}>
        <Ionicons name="star" size={18} color={colors.warning} />
        <Text style={[text.section, { color: colors.warning }]}>Featured in this match</Text>
      </View>
      <Text style={text.title}>{product.name}</Text>
      {product.description ? <Text style={[text.muted, { marginTop: 2 }]}>{product.description}</Text> : null}
      {v ? <Text style={[text.label, { marginTop: spacing.sm, fontSize: 18 }]}>{money(v.price_minor, v.currency)}</Text> : null}
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
  sideNote: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 2 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: spacing.lg, gap: 4 },
  side: { flex: 1, alignItems: 'center' },
  teamName: { fontSize: 14, fontWeight: '600', color: colors.text, textAlign: 'center' },
  scoreNum: { fontSize: 76, fontWeight: '800', lineHeight: 84, color: colors.text, fontVariant: ['tabular-nums'], minWidth: 40, textAlign: 'center' },
  dash: { fontSize: 15, fontWeight: '700', color: colors.textMuted, paddingHorizontal: 2 },
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
