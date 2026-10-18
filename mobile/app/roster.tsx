import { Icon } from '../src/components/Icon';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../src/api/client';
import { AppError, errorText } from '../src/api/errors';
import { RosterPlayer, RosterState } from '../src/api/types';
import { canManageRoster, useAuth } from '../src/auth/AuthContext';
import { positionLabel } from '../src/components/ClubProfileView';
import { ConfirmDialog } from '../src/components/ConfirmDialog';
import { Screen } from '../src/components/Screen';
import { useToast } from '../src/components/Toast';
import { CachedNotice, Card, Chip, EmptyState, ErrorBanner, Field, InfoBanner, LoadingView, PrimaryButton, SecondaryButton, SectionTitle, StatusPill } from '../src/components/ui';
import { useCachedQuery } from '../src/hooks/useCachedQuery';
import { humanize } from '../src/hooks/useClubNames';
import { cachedGet } from '../src/offline/cache';
import { listQueue, QueuedAction, subscribeQueue } from '../src/offline/queue';
import { useSync } from '../src/offline/SyncProvider';
import { colors, radius, spacing, text } from '../src/theme';

type MoveType = 'transfer' | 'loan' | 'release';

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (d: string, n: number) => {
  const t = new Date(d + 'T00:00:00Z');
  if (Number.isNaN(t.getTime())) return d;
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + 'T00:00:00Z').getTime());

const VERB: Record<MoveType, string> = { transfer: 'Transfer', loan: 'Loan', release: 'Release' };

export default function Roster() {
  const { user } = useAuth();
  const toast = useToast();
  const sync = useSync();
  const params = useLocalSearchParams<{ club?: string; add?: string }>();
  // Club managers always manage their own club; a super admin arrives with ?club= from a club profile.
  const clubId = user?.club_id ?? (user?.role === 'super_admin' && params.club ? String(params.club) : null);
  const allowed = canManageRoster(user?.role);
  const q = useCachedQuery<RosterState>(clubId && allowed ? `roster:${clubId}` : null, clubId && allowed ? `/api/v1/roster/${encodeURIComponent(clubId)}` : null);
  const [queued, setQueued] = useState<QueuedAction[]>([]);
  const [player, setPlayer] = useState<RosterPlayer | null>(null);
  const [type, setType] = useState<MoveType>('transfer');
  const [toSquad, setToSquad] = useState<string | null>(null);
  const [effective, setEffective] = useState(today());
  const [loanEnd, setLoanEnd] = useState(plusDays(today(), 30));
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addConfirm, setAddConfirm] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addId, setAddId] = useState(() => randomUUID());
  const [addName, setAddName] = useState('');
  const [addPosition, setAddPosition] = useState('');
  const [addRole, setAddRole] = useState('substitute');

  const loadQueued = useCallback(() => {
    listQueue()
      .then((all) => setQueued(all.filter((a) => a.type === 'roster_transfer')))
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadQueued();
    return subscribeQueue(loadQueued);
  }, [loadQueued]);

  const data = q.data;
  // Club profile > Manage club > Add a player opens the add form once the roster has loaded.
  const addOpened = useRef(false);
  useEffect(() => {
    if (addOpened.current || params.add !== '1' || !data?.squad_id || !sync.online) return;
    addOpened.current = true;
    openAdd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.add, data?.squad_id, sync.online]);
  const squads = data?.squads ?? [];
  const otherSquads = squads.filter((s) => s.squad_id !== player?.squad_id);
  const squadName = (id: string | null) => squads.find((s) => s.squad_id === id)?.name ?? id ?? '';

  const open = (p: RosterPlayer, t: MoveType) => {
    setPlayer(p);
    setType(t);
    setToSquad(squads.find((s) => s.squad_id !== p.squad_id)?.squad_id ?? null);
    setEffective(today());
    setLoanEnd(plusDays(today(), 30));
    setReason('');
    setFormError(null);
  };

  const openAdd = () => {
    setAddId(randomUUID());
    setAddName('');
    setAddPosition('');
    setAddRole('substitute');
    setAddError(null);
    setAdding(true);
  };

  const reviewAdd = () => {
    if (!addName.trim() || addName.trim().length > 100) {
      setAddError('Enter a player name of up to 100 characters.');
    } else if (!addPosition.trim() || addPosition.trim().length > 32) {
      setAddError('Enter a position of up to 32 characters.');
    } else {
      setAddError(null);
      setAddConfirm(true);
    }
  };

  const submitAdd = async () => {
    if (!clubId) return;
    setAddConfirm(false);
    setAddBusy(true);
    try {
      await api(`/api/v1/roster/${encodeURIComponent(clubId)}/players`, {
        method: 'POST',
        body: { player_id: addId, name: addName.trim(), position: addPosition.trim(), role: addRole },
      });
      setAdding(false);
      q.reload();
      toast(`${addName.trim()} added to the roster.`);
    } catch (e) {
      const err = e instanceof AppError ? e : new AppError('UNKNOWN');
      if (err.code === 'DUPLICATE_PLAYER_ID') {
        setAdding(false);
        q.reload();
        toast('This player was already added. Roster refreshed.', 'info');
      } else {
        const msg = err.isNetwork ? "Couldn't add the player because the server is unreachable. Reconnect and try again." : errorText(err);
        setAddError(msg);
        toast(msg, 'error');
      }
    } finally {
      setAddBusy(false);
    }
  };

  const validate = (): string | null => {
    if (!isDate(effective)) return 'Enter the effective date as YYYY-MM-DD.';
    if (type !== 'release' && !toSquad) return 'Choose the destination squad.';
    if (type === 'loan') {
      if (!isDate(loanEnd)) return 'Enter the loan end date as YYYY-MM-DD.';
      if (loanEnd <= effective) return 'The loan must end after it starts.';
    }
    return null;
  };

  const review = () => {
    const err = validate();
    setFormError(err);
    if (!err) setConfirm(true);
  };

  const submit = async () => {
    if (!player || !data?.league_id || !user) return;
    setConfirm(false);
    setBusy(true);
    setFormError(null);
    // base_version = number of audit entries for this player (0 if unknown / 404).
    let base = 0;
    try {
      const h = await cachedGet<{ history: unknown[] }>(`history:${player.player_id}`, `/audit/v1/roster/history/${encodeURIComponent(player.player_id)}`);
      base = h.data.history?.length ?? 0;
    } catch {
      base = 0;
    }
    const body = {
      request_id: randomUUID(),
      league_id: data.league_id,
      player_id: player.player_id,
      type,
      from_squad_id: player.squad_id,
      to_squad_id: type === 'release' ? null : toSquad,
      effective_date: effective,
      loan_end_date: type === 'loan' ? loanEnd : null,
      reason: reason.trim() || `${VERB[type]} by club manager`,
      requested_by: user.user_id,
    };
    const label = `${VERB[type]} ${player.name}${type === 'release' ? '' : ` to ${squadName(toSquad)}`}`;
    try {
      const r = await sync.submitOrQueue({ type: 'roster_transfer', path: '/audit/v1/roster/transfer', body, baseVersion: base, label });
      setPlayer(null);
      if (r.queued) toast('Saved on this phone. It will sync when you are back online.', 'info');
      else {
        toast(`${label}: done.`);
        q.reload();
      }
    } catch (e) {
      const msg = e instanceof AppError ? errorText(e) : errorText(e);
      setFormError(msg);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!allowed || !clubId) {
    return (
      <Screen title="Roster" back>
        <EmptyState icon="lock-closed-outline" title="Only club managers can manage a roster" message="Sign in with a club manager account to transfer, loan or release players." />
      </Screen>
    );
  }

  const players = data?.players ?? [];
  const pendingFor = (pid: string) => queued.filter((a) => a.payload?.player_id === pid);

  return (
    <Screen title="Manage roster" subtitle={squadName(data?.squad_id ?? null)} back onRefresh={q.refresh} refreshing={q.refreshing} testID="roster-screen">
      {q.fromCache && q.updatedAt ? <CachedNotice updatedAt={q.updatedAt} /> : null}
      {!sync.online ? <InfoBanner tone="warning" icon="cloud-offline-outline" message="You're offline. Transfers, loans and releases will sync when you reconnect. Adding a new player needs a connection." /> : null}
      {data?.transfer_window ? (
        <InfoBanner icon="calendar-outline" message={`Transfer window: ${data.transfer_window.open} to ${data.transfer_window.close}. Releases are allowed on any date.`} testID="roster-window" />
      ) : null}
      {q.loading && !data ? <LoadingView label="Loading roster…" /> : null}
      {q.error && !data ? <ErrorBanner message={q.error} onRetry={q.refresh} /> : null}
      {data?.squad_id ? (
        <SecondaryButton title="Add player" icon="person-add-outline" onPress={openAdd} disabled={!sync.online} testID="roster-add" style={{ marginBottom: spacing.sm }} />
      ) : null}
      {data && !players.length ? <EmptyState icon="people-outline" title="No players in this squad yet" message="Players registered to your squad will appear here." /> : null}
      {players.length ? <SectionTitle>Players ({players.length})</SectionTitle> : null}
      {players.map((p) => {
        const onLoan = !!p.parent_squad_id;
        const pend = pendingFor(p.player_id);
        return (
          <Card key={p.player_id} testID={`roster-player-${p.player_id}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Icon name="person-circle" size={36} color={colors.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={text.label}>{p.name}</Text>
                <Text style={text.small}>
                  {positionLabel(p.position)} · {humanize(p.role)}
                </Text>
              </View>
            </View>
            {onLoan ? (
              <View style={{ marginTop: spacing.sm }}>
                <StatusPill kind="upcoming" label={`ON LOAN FROM ${squadName(p.parent_squad_id).toUpperCase()}`} />
              </View>
            ) : null}
            {pend.map((a) => (
              <View key={a.action_id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' }}>
                <StatusPill kind="pending" />
                <Text style={[text.small, { flex: 1 }]}>{a.label} is waiting to sync.</Text>
              </View>
            ))}
            <View style={styles.actions}>
              <SecondaryButton title="Transfer" compact icon="swap-horizontal" onPress={() => open(p, 'transfer')} testID={`roster-transfer-${p.player_id}`} style={styles.actionBtn} />
              <SecondaryButton title="Loan" compact icon="time-outline" onPress={() => open(p, 'loan')} testID={`roster-loan-${p.player_id}`} style={styles.actionBtn} />
              <SecondaryButton title="Release" compact danger icon="exit-outline" onPress={() => open(p, 'release')} testID={`roster-release-${p.player_id}`} style={styles.actionBtn} />
            </View>
          </Card>
        );
      })}

      <Modal visible={adding && !addConfirm} animationType="slide" transparent onRequestClose={() => setAdding(false)} supportedOrientations={['portrait', 'landscape']}>
        <View style={styles.backdrop}>
          <View style={styles.sheet} testID="roster-add-form">
            <ScrollView contentContainerStyle={{ padding: spacing.xl }} keyboardShouldPersistTaps="handled">
              <Text style={[text.title, { marginBottom: spacing.md }]} accessibilityRole="header">Add a player</Text>
              <Field label="Player name" testID="roster-add-name" value={addName} onChangeText={setAddName} autoCorrect={false} placeholder="Full name" />
              <Field label="Position" testID="roster-add-position" value={addPosition} onChangeText={setAddPosition} autoCapitalize="characters" autoCorrect={false} placeholder="For example FW or Goalkeeper" />
              <Text style={[text.section, { marginBottom: spacing.sm }]}>Squad role</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }} accessibilityRole="radiogroup">
                {(['substitute', 'starter', 'vice_captain', 'captain'] as const).map((role) => (
                  <Chip key={role} label={humanize(role)} selected={addRole === role} onPress={() => setAddRole(role)} testID={`roster-add-role-${role}`} />
                ))}
              </View>
              {addError ? <ErrorBanner message={addError} testID="roster-add-error" /> : null}
              <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
                <PrimaryButton title="Review new player" onPress={reviewAdd} loading={addBusy} testID="roster-add-review" />
                <SecondaryButton title="Cancel" onPress={() => setAdding(false)} disabled={addBusy} testID="roster-add-cancel" />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <ConfirmDialog
        visible={addConfirm}
        title="Add player to roster?"
        message={`Add ${addName.trim()} as ${humanize(addRole)} in ${squadName(data?.squad_id ?? null)}?`}
        confirmTitle="Add player"
        onCancel={() => setAddConfirm(false)}
        onConfirm={submitAdd}
        testID="roster-add-confirm"
      />

      <Modal visible={!!player && !confirm} animationType="slide" transparent onRequestClose={() => setPlayer(null)} supportedOrientations={['portrait', 'landscape']}>
        <View style={styles.backdrop}>
          <View style={styles.sheet} testID="roster-form">
            <ScrollView contentContainerStyle={{ padding: spacing.xl }} keyboardShouldPersistTaps="handled">
              <Text style={[text.title, { marginBottom: spacing.md }]} accessibilityRole="header">
                {VERB[type]} {player?.name}
              </Text>
              <Text style={[text.section, { marginBottom: spacing.sm }]}>Action</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }} accessibilityRole="radiogroup">
                {(['transfer', 'loan', 'release'] as MoveType[]).map((t) => (
                  <Chip key={t} label={VERB[t]} selected={type === t} onPress={() => setType(t)} testID={`roster-type-${t}`} />
                ))}
              </View>
              {type !== 'release' ? (
                <>
                  <Text style={[text.section, { marginVertical: spacing.sm }]}>Destination squad</Text>
                  {otherSquads.length ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }} accessibilityRole="radiogroup">
                      {otherSquads.map((s) => (
                        <Chip key={s.squad_id} label={s.name} selected={toSquad === s.squad_id} onPress={() => setToSquad(s.squad_id)} testID={`roster-to-${s.squad_id}`} />
                      ))}
                    </View>
                  ) : (
                    <Text style={text.muted}>There are no other squads in this league.</Text>
                  )}
                </>
              ) : (
                <InfoBanner tone="warning" icon="warning" message="The player will leave the league and will no longer belong to any squad." />
              )}
              <View style={{ height: spacing.sm }} />
              <Field label="Effective date (YYYY-MM-DD)" testID="roster-effective" value={effective} onChangeText={setEffective} keyboardType="numbers-and-punctuation" autoCorrect={false} />
              {type === 'loan' ? (
                <Field label="Loan end date (YYYY-MM-DD)" testID="roster-loan-end" value={loanEnd} onChangeText={setLoanEnd} keyboardType="numbers-and-punctuation" autoCorrect={false} />
              ) : null}
              <Field label="Reason (optional)" testID="roster-reason" value={reason} onChangeText={setReason} placeholder="For example: tactical move" />
              {formError ? <ErrorBanner message={formError} testID="roster-error" /> : null}
              <View style={{ gap: spacing.sm }}>
                <PrimaryButton title={`Review ${VERB[type].toLowerCase()}`} onPress={review} loading={busy} testID="roster-review" />
                <SecondaryButton title="Cancel" onPress={() => setPlayer(null)} disabled={busy} testID="roster-cancel" />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <ConfirmDialog
        visible={confirm}
        title={`Confirm ${VERB[type].toLowerCase()}`}
        message={
          player
            ? type === 'release'
              ? `Release ${player.name} from ${squadName(player.squad_id)} on ${effective}? This cannot be undone from the app.`
              : type === 'loan'
                ? `Loan ${player.name} to ${squadName(toSquad)} from ${effective} until ${loanEnd}?`
                : `Transfer ${player.name} permanently to ${squadName(toSquad)} on ${effective}?`
            : ''
        }
        confirmTitle={VERB[type]}
        destructive={type === 'release'}
        onCancel={() => setConfirm(false)}
        onConfirm={submit}
        testID="roster-confirm"
      >
        {!sync.online ? <InfoBanner tone="warning" icon="cloud-offline-outline" message="You're offline. This will be saved and sent when you reconnect." /> : null}
      </ConfirmDialog>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  actionBtn: { flexGrow: 1, minWidth: 96 },
  backdrop: { flex: 1, backgroundColor: 'rgba(17,24,39,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '92%' },
});
