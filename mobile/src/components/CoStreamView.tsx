// Co-stream screen (FR-3.3): composite HLS player, split view of up to 4 broadcasters
// (grid_2 / grid_4 / spotlight), host controls (mute, spotlight, kick, signed invites), the unified
// chat room chat-{session_id} in sequence order, and the host-drop handoff check.
// Live state comes from ws://<server>/ws/costream/{id} (with a 3 s poll as fallback). A signed-in
// participant's socket carries its token, so the server notices an abrupt disconnect and hands over.
// Guests opened by nascon://stream/{id} can watch and read chat; writing needs sign-in.
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, getToken } from '../api/client';
import { AppError, errorText } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import { useChatRoom } from '../realtime/chat';
import { useNotify } from '../realtime/NotificationProvider';
import { forDevice, serverHost, wsUrl } from '../realtime/urls';
import { colors, radius, spacing, text, TOUCH } from '../theme';
import { ConfirmDialog } from './ConfirmDialog';
import { HlsPlayer } from './HlsPlayer';
import { Icon } from './Icon';
import { QrCard } from './QrCard';
import { useToast } from './Toast';
import { Card, Chip, ErrorBanner, Field, InfoBanner, PrimaryButton, SecondaryButton, SectionTitle } from './ui';

export type Layout = 'grid_2' | 'grid_4' | 'spotlight';
const LAYOUTS: { id: Layout; label: string }[] = [
  { id: 'grid_2', label: 'Side by side' },
  { id: 'grid_4', label: 'Grid of 4' },
  { id: 'spotlight', label: 'Spotlight' },
];
// Squad used when a host starts a new session (the spec 5.5 example); editable before starting.
const DEFAULT_SQUAD = ['player-alpha-1', 'player-alpha-2', 'player-beta-1', 'player-beta-2'];
const SETUP_ROLES = new Set(['player', 'league_organizer', 'super_admin']);
const POLL_MS = 3000;

type Session = {
  session_id: string;
  status: string;
  active_host: string | null;
  handoff_occurred?: boolean;
  participant_count: number;
  active_participants: string[];
  layout: string;
  composite_playback_url: string | null;
  chat_room_id: string;
  muted?: string[];
  spotlight?: string | null;
};
type Handoff = { from: string; to: string | null; status: string; count: number };
type Control = 'mute' | 'unmute' | 'spotlight' | 'kick';

const isLayout = (l: unknown): l is Layout => l === 'grid_2' || l === 'grid_4' || l === 'spotlight';

export function CoStreamView({ sessionId, inviteToken }: { sessionId: string; inviteToken?: string }) {
  const { user } = useAuth();
  const toast = useToast();
  const { notify } = useNotify();
  const [session, setSession] = useState<Session | null>(null);
  const [missing, setMissing] = useState(false);
  const [layout, setLayout] = useState<Layout>('grid_4');
  const [squadText, setSquadText] = useState(DEFAULT_SQUAD.join(', '));
  const [kickTarget, setKickTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [draft, setDraft] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);
  const [invitee, setInvitee] = useState('');
  const [invite, setInvite] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const room = session?.chat_room_id ?? `chat-${sessionId}`;
  const chat = useChatRoom(room);
  const chatScroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const hostRef = useRef<string | null>(null);
  const layoutTouched = useRef(false);

  const apply = useCallback(
    (s: Session) => {
      const prevHost = hostRef.current;
      hostRef.current = s.active_host;
      setSession(s);
      setMissing(false);
      if (!layoutTouched.current && isLayout(s.layout)) setLayout(s.layout);
      if (prevHost && prevHost !== s.active_host) {
        notify({
          kind: 'invite',
          title: s.status === 'terminated' ? 'Co-stream ended' : 'New host',
          message: s.status === 'terminated' ? `${sessionId} has ended.` : `${s.active_host} is now hosting ${sessionId}.`,
        });
      }
    },
    [notify, sessionId],
  );

  const load = useCallback(async () => {
    try {
      apply(await api<Session>(`/api/v1/costream/${encodeURIComponent(sessionId)}`));
    } catch (e: any) {
      if (e?.code === 'STREAM_NOT_FOUND') return setMissing(true);
      try {
        apply(await api<Session>(`/api/v1/guest/costream/${encodeURIComponent(sessionId)}`, { auth: false }));
      } catch (e2: any) {
        if (e2?.code === 'STREAM_NOT_FOUND') setMissing(true);
      }
    }
  }, [apply, sessionId]);

  // Live session + chat over one socket; poll while it is down.
  const pushChat = chat.push;
  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const startPoll = () => {
      if (!poll) poll = setInterval(load, POLL_MS);
    };
    const stopPoll = () => {
      if (poll) clearInterval(poll);
      poll = null;
    };
    const connect = () => {
      if (closed) return;
      const token = getToken();
      try {
        ws = new WebSocket(wsUrl(`/ws/costream/${encodeURIComponent(sessionId)}${token ? `?token=${encodeURIComponent(token)}` : ''}`));
      } catch {
        startPoll();
        return;
      }
      ws.onopen = () => {
        setLive(true);
        stopPoll();
      };
      ws.onmessage = (m) => {
        try {
          const msg = JSON.parse(String(m.data));
          if (msg?.type === 'costream' && msg.data) apply(msg.data as Session);
          else if (msg?.type === 'chat' && msg.data) pushChat(msg.data);
          else if (msg?.type === 'error' && msg.code === 'STREAM_NOT_FOUND') setMissing(true);
        } catch {
          // ignore malformed frames
        }
      };
      ws.onerror = () => {};
      ws.onclose = () => {
        ws = null;
        setLive(false);
        if (closed) return;
        startPoll();
        retry = setTimeout(connect, 3000);
      };
    };
    load();
    connect();
    return () => {
      closed = true;
      stopPoll();
      if (retry) clearTimeout(retry);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
    // Reconnect when the user signs in or out so the socket carries the right token.
  }, [sessionId, load, apply, pushChat, user?.user_id]);

  const squad = parseSquad(squadText);
  const participants = session?.active_participants ?? [];
  const activeHost = session?.active_host ?? null;
  const muted = new Set(session?.muted ?? []);
  const isHost = !!user?.player_id && user.player_id === activeHost && session?.status === 'active';
  const canSetup = !!user && SETUP_ROLES.has(user.role);
  const terminated = session?.status === 'terminated';
  const composite = forDevice(session?.composite_playback_url) ?? `http://${serverHost()}:8888/costream/${sessionId}/index.m3u8`;

  const submit = async (opts: { participants: string[]; host: string | null; layout: Layout; simulate?: boolean; label: string }) => {
    const host = opts.host && opts.participants.includes(opts.host) ? opts.host : opts.participants[0];
    if (!host) return setError('Add at least one player ID to the squad.');
    if (opts.participants.length > 4) return setError('A co-stream supports up to 4 broadcasters. Remove a player first.');
    setError(null);
    setBusy(opts.label);
    try {
      const r = await api<Session>('/audit/v1/costream/session', {
        method: 'POST',
        body: { session_id: sessionId, host_player_id: host, participants: opts.participants, layout: opts.layout, simulate_host_drop: !!opts.simulate },
      });
      if (opts.simulate) {
        hostRef.current = r.active_host; // the result card explains the handoff; no extra banner
        setHandoff({ from: host, to: r.active_host, status: r.status, count: r.participant_count });
      }
      apply({ ...r, muted: session?.muted, spotlight: session?.spotlight });
      load();
    } catch (e) {
      const code = e instanceof AppError ? e.code : '';
      setError(
        code === 'UNSUPPORTED_LAYOUT'
          ? 'That layout has room for fewer broadcasters than are live. Pick another layout or remove a player.'
          : code === 'COSTREAM_SESSION_FULL'
            ? 'A co-stream supports up to 4 broadcasters.'
            : errorText(e),
      );
    } finally {
      setBusy(null);
    }
  };

  const control = async (action: Control, pid: string) => {
    setError(null);
    setBusy(`${action}-${pid}`);
    try {
      const r = await api<Session>(`/api/v1/costream/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(pid)}/${action}`, { method: 'POST' });
      apply(r);
      if (action === 'spotlight') {
        layoutTouched.current = true;
        setLayout('spotlight');
      }
      toast({ mute: `${pid} is muted.`, unmute: `${pid} can speak again.`, spotlight: `${pid} is in the spotlight.`, kick: `${pid} was removed from the co-stream.` }[action]);
    } catch (e) {
      const code = e instanceof AppError ? e.code : '';
      setError(code === 'FORBIDDEN' ? 'Only the active host can do that.' : errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const changeLayout = (l: Layout) => {
    layoutTouched.current = true;
    setLayout(l);
    // The host's choice is saved for everyone; viewers only change their own view.
    if (isHost && session && l !== session.layout) submit({ participants, host: activeHost, layout: l, label: 'layout' });
  };

  const createInvite = async () => {
    const pid = invitee.trim();
    if (!pid) return setError('Enter the player ID to invite.');
    setError(null);
    setBusy('invite');
    try {
      const r = await api<{ token: string }>(`/api/v1/costream/${encodeURIComponent(sessionId)}/invites`, { method: 'POST', body: { player_id: pid } });
      const link = `nascon://stream/${sessionId}?invite=${encodeURIComponent(r.token)}`;
      setInvite(link);
      await Clipboard.setStringAsync(link);
      toast(`Invite for ${pid} copied. It works for one hour.`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const join = async () => {
    if (!inviteToken) return;
    setError(null);
    setBusy('join');
    try {
      apply(await api<Session>(`/api/v1/costream/${encodeURIComponent(sessionId)}/join`, { method: 'POST', body: { invite_token: inviteToken } }));
      toast('You joined the co-stream as a broadcaster.');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const sendChat = async () => {
    if (!user) return router.push('/login');
    setChatError(null);
    try {
      await chat.send(draft);
      setDraft('');
    } catch (e) {
      const code = e instanceof AppError ? e.code : '';
      setChatError(code === 'GUEST_WRITE_FORBIDDEN' ? 'Sign in as a member to chat.' : errorText(e));
    }
  };

  const spotlightId = layout === 'spotlight' ? (session?.spotlight && participants.includes(session.spotlight) ? session.spotlight : activeHost ?? participants[0] ?? null) : null;
  const ordered = spotlightId ? [spotlightId, ...participants.filter((p) => p !== spotlightId)] : participants;
  const shown = ordered.slice(0, layout === 'grid_2' ? 2 : 4);

  return (
    <View testID="costream-screen">
      <HlsPlayer url={terminated ? null : composite} testID="costream-composite" label={`Co-stream ${sessionId}`} idleMessage="This co-stream has ended." />
      <Text style={[text.small, { marginBottom: spacing.sm }]} testID="costream-status">
        {session
          ? `${terminated ? 'Ended' : 'Live'} · ${session.participant_count} broadcaster${session.participant_count === 1 ? '' : 's'} · host ${activeHost ?? 'none'}${live ? '' : ' · reconnecting'}`
          : missing
            ? 'This co-stream has not started yet.'
            : 'Connecting to the co-stream…'}
      </Text>

      <Card testID="costream-chat" style={{ paddingBottom: spacing.sm }}>
        <View style={styles.headRow}>
          <Text style={text.title} accessibilityRole="header">
            Live chat
          </Text>
          <Text style={text.small}>{room}</Text>
        </View>
        <ScrollView
          testID="chat-message-list"
          style={styles.chatList}
          nestedScrollEnabled
          ref={chatScroll}
          onContentSizeChange={() => chatScroll.current?.scrollToEnd({ animated: false })}
          accessibilityLabel="Chat messages"
        >
          {chat.messages.length === 0 ? (
            <Text style={text.muted} testID="chat-empty">
              {chat.error ? 'Chat is not available right now.' : 'No messages yet.'}
            </Text>
          ) : (
            chat.messages.map((m) => (
              <View key={m.key} style={styles.msg} testID={`chat-msg-${m.seq}`}>
                <Text style={styles.seq} accessibilityLabel={`Message ${m.seq}`}>
                  #{m.seq}
                </Text>
                <Text style={styles.msgText}>
                  <Text style={styles.sender}>{m.sender} </Text>
                  {m.text}
                </Text>
              </View>
            ))
          )}
        </ScrollView>
        {chatError ? <ErrorBanner message={chatError} testID="chat-error" /> : null}
        {user ? (
          <View style={styles.inputRow}>
            <TextInput
              testID="chat-input-field"
              accessibilityLabel="Chat message"
              placeholder="Write a message"
              placeholderTextColor="#8E8E93"
              value={draft}
              onChangeText={setDraft}
              style={styles.input}
              maxLength={280}
              returnKeyType="send"
              onSubmitEditing={sendChat}
            />
            <PrimaryButton title="Send" compact onPress={sendChat} loading={chat.sending} disabled={!draft.trim()} testID="chat-send-btn" style={{ minWidth: 88 }} />
          </View>
        ) : (
          <SecondaryButton title="Sign in to chat" icon="log-in-outline" onPress={() => router.push('/login')} testID="chat-signin" />
        )}
      </Card>

      {!user ? <InfoBanner message="You are watching as a guest. Sign in to chat or to broadcast." testID="costream-guest" /> : null}
      {error ? <ErrorBanner message={error} testID="costream-error" /> : null}

      {inviteToken && user && !participants.includes(user.player_id ?? '') ? (
        <Card testID="costream-join-card">
          <Text style={[text.body, { marginBottom: spacing.sm }]}>You have been invited to broadcast in this co-stream.</Text>
          <PrimaryButton title="Join as broadcaster" icon="videocam" onPress={join} loading={busy === 'join'} testID="costream-join" />
        </Card>
      ) : null}

      <SectionTitle>Broadcasters</SectionTitle>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Layout">
        {LAYOUTS.map((l) => (
          <Chip key={l.id} label={l.label} selected={layout === l.id} onPress={() => changeLayout(l.id)} testID={`costream-layout-${l.id}`} />
        ))}
      </View>
      {shown.length ? (
        <View style={styles.grid} testID="costream-grid">
          {shown.map((pid, i) => {
            const big = !!spotlightId && i === 0;
            return (
              <View
                key={pid}
                testID={`costream-tile-${pid}`}
                style={[styles.tile, big ? styles.tileBig : { width: spotlightId ? '31.5%' : '48.5%' }]}
                accessible
                accessibilityLabel={`${pid}${pid === activeHost ? ', host' : ''}${muted.has(pid) ? ', muted' : ''}${big ? ', in the spotlight' : ''}`}
              >
                <Icon name="person-circle" size={big ? 48 : 32} color={colors.textMuted} />
                <Text style={styles.tileName} numberOfLines={1}>
                  {pid}
                </Text>
                <View style={styles.tags}>
                  {pid === activeHost ? <Tag icon="crown" label="Host" /> : null}
                  {muted.has(pid) ? <Tag icon="mic-off" label="Muted" tone="danger" /> : null}
                  {big ? <Tag icon="star" label="Spotlight" /> : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={[text.muted, { marginBottom: spacing.md }]} testID="costream-grid-empty">
          {terminated ? 'Nobody is broadcasting.' : 'Broadcasters appear here once the co-stream starts.'}
        </Text>
      )}
      {layout === 'grid_2' && participants.length > 2 ? (
        <InfoBanner tone="warning" message={`Side by side shows 2 of the ${participants.length} broadcasters.`} testID="costream-layout-warning" />
      ) : null}

      {isHost ? (
        <>
          <SectionTitle>Host controls</SectionTitle>
          <Card testID="costream-host-controls">
            {participants.map((pid) => (
              <View key={pid} style={styles.ctrlRow}>
                <Text style={[text.label, { flexBasis: '100%' }]} numberOfLines={1}>
                  {pid}
                  {pid === activeHost ? ' (you, host)' : ''}
                </Text>
                <SecondaryButton
                  compact
                  title={muted.has(pid) ? 'Unmute' : 'Mute'}
                  icon={muted.has(pid) ? 'mic' : 'mic-off'}
                  onPress={() => control(muted.has(pid) ? 'unmute' : 'mute', pid)}
                  loading={busy === `mute-${pid}` || busy === `unmute-${pid}`}
                  testID={`costream-mute-${pid}`}
                  accessibilityLabel={`${muted.has(pid) ? 'Unmute' : 'Mute'} ${pid}`}
                  style={{ flex: 1 }}
                />
                <SecondaryButton compact title="Spotlight" icon="star" onPress={() => control('spotlight', pid)} loading={busy === `spotlight-${pid}`} testID={`costream-spotlight-${pid}`} accessibilityLabel={`Spotlight ${pid}`} style={{ flex: 1 }} />
                <SecondaryButton
                  compact
                  title="Kick"
                  icon="person-remove"
                  danger
                  onPress={() => setKickTarget(pid)}
                  disabled={pid === activeHost}
                  testID={`costream-kick-${pid}`}
                  accessibilityLabel={`Remove ${pid} from the co-stream`}
                  style={{ flex: 1 }}
                />
              </View>
            ))}
            <Field label="Invite a squad member (player ID)" testID="costream-invitee" value={invitee} onChangeText={setInvitee} autoCapitalize="none" autoCorrect={false} placeholder="player-beta-2" />
            <SecondaryButton title="Create signed invite" icon="link" onPress={createInvite} loading={busy === 'invite'} testID="costream-invite" />
            {invite ? (
              <Text style={[text.small, { marginTop: spacing.sm }]} selectable testID="costream-invite-link" numberOfLines={2}>
                {invite}
              </Text>
            ) : null}
          </Card>
        </>
      ) : null}

      {canSetup ? (
        <>
          <SectionTitle>Session setup</SectionTitle>
          <Card testID="costream-setup">
            <Field
              label="Squad: up to 4 player IDs separated by commas. The first one hosts."
              testID="costream-squad"
              value={squadText}
              onChangeText={setSquadText}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <PrimaryButton
              title={session && !terminated ? 'Restart with this squad' : 'Start co-stream'}
              icon="videocam"
              onPress={() => submit({ participants: squad, host: squad[0] ?? null, layout, label: 'start' })}
              loading={busy === 'start'}
              disabled={!!busy}
              testID="costream-start"
            />
            <SecondaryButton
              title="Test host drop"
              icon="pulse"
              onPress={() => submit({ participants: participants.length ? participants : squad, host: activeHost ?? squad[0] ?? null, layout, simulate: true, label: 'drop' })}
              loading={busy === 'drop'}
              disabled={!!busy}
              testID="costream-simulate-drop"
              accessibilityHint="Simulates the host disconnecting and shows who takes over"
              style={{ marginTop: spacing.sm }}
            />
          </Card>
        </>
      ) : null}

      {handoff ? (
        <Card testID="costream-handoff-result">
          <Text style={text.title}>Host drop result</Text>
          <Text style={[text.body, { marginTop: spacing.xs }]} testID="costream-active-host">
            {handoff.to
              ? `${handoff.from} dropped. ${handoff.to} took over as host, with ${handoff.count} broadcaster${handoff.count === 1 ? '' : 's'} still live.`
              : `${handoff.from} was the only broadcaster, so the session ended cleanly.`}
          </Text>
          <Text style={text.small} testID="costream-handoff-status">
            Session status: {handoff.status}
          </Text>
        </Card>
      ) : null}

      <QrCard entityId={sessionId} title="Invite viewers with a QR code" />

      <ConfirmDialog
        visible={!!kickTarget}
        title={`Remove ${kickTarget ?? ''}?`}
        message="They leave the co-stream at once. You can invite them again later."
        confirmTitle="Remove"
        destructive
        onCancel={() => setKickTarget(null)}
        onConfirm={() => {
          const t = kickTarget;
          setKickTarget(null);
          if (t) control('kick', t);
        }}
        testID="costream-kick-confirm"
      />
    </View>
  );
}

function parseSquad(s: string): string[] {
  const out: string[] = [];
  for (const p of s.split(/[\s,]+/)) if (p && !out.includes(p)) out.push(p);
  return out;
}

function Tag({ icon, label, tone }: { icon: 'crown' | 'mic-off' | 'star'; label: string; tone?: 'danger' }) {
  const c = tone === 'danger' ? colors.danger : colors.accent;
  return (
    <View style={styles.tag}>
      <Icon name={icon} size={12} color={c} />
      <Text style={[styles.tagText, { color: c }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  chatList: { height: 200, marginBottom: spacing.sm },
  msg: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 4 },
  seq: { color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_600SemiBold', minWidth: 32 },
  msgText: { flex: 1, color: colors.text, fontSize: 15, fontFamily: 'Inter_400Regular' },
  sender: { fontFamily: 'Inter_700Bold', color: colors.accent },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: { flex: 1, minHeight: TOUCH, borderRadius: radius.sm, backgroundColor: colors.cardHi, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)', color: colors.text, paddingHorizontal: spacing.md, fontSize: 15, fontFamily: 'Inter_400Regular' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  tile: { aspectRatio: 16 / 10, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)', borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', padding: spacing.sm },
  tileBig: { width: '100%', aspectRatio: 16 / 9 },
  tileName: { color: colors.text, fontSize: 13, fontFamily: 'Inter_600SemiBold', marginTop: 4 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4, justifyContent: 'center' },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.cardHi, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
  tagText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  ctrlRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.md, flexWrap: 'wrap' },
});
