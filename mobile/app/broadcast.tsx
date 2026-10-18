// Broadcaster (FR-3.2): manage the signed stream key (generate / rotate / revoke via
// POST /audit/v1/stream/key), show the RTMP and WHIP ingest addresses for OBS or FFmpeg, and
// preview the HLS playback with the live score and pinned product drawn over the video.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../src/api/client';
import { errorText } from '../src/api/errors';
import { Match } from '../src/api/types';
import { useAuth } from '../src/auth/AuthContext';
import { ConfirmDialog } from '../src/components/ConfirmDialog';
import { HlsPlayer } from '../src/components/HlsPlayer';
import { Icon } from '../src/components/Icon';
import { ProductOverlay, ScoreOverlay, useLiveOverlay } from '../src/components/LiveOverlay';
import { Screen } from '../src/components/Screen';
import { useToast } from '../src/components/Toast';
import { Card, Chip, ErrorBanner, Field, InfoBanner, PrimaryButton, SecondaryButton, SectionTitle, StatusPill } from '../src/components/ui';
import { readCache } from '../src/offline/cache';
import { feedLabel } from '../src/realtime/matchFeed';
import { forDevice, splitRtmp } from '../src/realtime/urls';
import { useLeague } from '../src/store/LeagueContext';
import { colors, radius, spacing, text, TOUCH } from '../src/theme';

type KeyAction = 'generate' | 'rotate' | 'revoke';
type StreamKey = {
  player_id: string;
  label?: string;
  stream_key: string;
  status: 'active' | 'revoked' | string;
  ingest_endpoints: { rtmp: string; webrtc: string } | null;
  playback_url: string | null;
};

const storeKey = (playerId: string) => `nascon.streamKey.${playerId}`;
const CAN_BROADCAST = new Set(['player', 'league_organizer', 'super_admin', 'club_manager']);

export default function Broadcast() {
  const { user } = useAuth();
  const toast = useToast();
  const { league } = useLeague();
  const [playerId, setPlayerId] = useState(user?.player_id ?? '');
  const [label, setLabel] = useState('mobile');
  const [key, setKey] = useState<StreamKey | null>(null);
  const [busy, setBusy] = useState<KeyAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchId, setMatchId] = useState<string>('');

  // Last key for this player survives app restarts (the key itself is not secret to its owner).
  useEffect(() => {
    if (!playerId) return;
    AsyncStorage.getItem(storeKey(playerId))
      .then((v) => setKey(v ? (JSON.parse(v) as StreamKey) : null))
      .catch(() => setKey(null));
  }, [playerId]);

  useEffect(() => {
    if (!league) return;
    readCache<{ matches: Match[] }>(`matches:${league.league_id}`).then((c) => {
      const list = (c?.data.matches ?? []).filter((m) => m.status === 'in_progress' || m.status === 'upcoming').slice(0, 6);
      setMatches(list);
      setMatchId((cur) => cur || list.find((m) => m.status === 'in_progress')?.match_id || list[0]?.match_id || 'match-m1');
    });
  }, [league]);

  const overlay = useLiveOverlay(matchId.trim() || null);

  const run = async (action: KeyAction) => {
    const pid = playerId.trim();
    if (!pid) return setError('Enter the player ID that will broadcast.');
    setError(null);
    setBusy(action);
    try {
      const r = await api<StreamKey>('/audit/v1/stream/key', { method: 'POST', body: { action, player_id: pid, label: label.trim() || 'default' } });
      setKey(r);
      AsyncStorage.setItem(storeKey(pid), JSON.stringify(r)).catch(() => {});
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast(
        action === 'revoke'
          ? 'Stream key revoked. Any live broadcast using it has been cut off.'
          : action === 'rotate'
            ? 'New stream key issued. The old key no longer works.'
            : 'Stream key ready. Copy it into OBS or FFmpeg to go live.',
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const copy = async (value: string, what: string) => {
    await Clipboard.setStringAsync(value);
    toast(`${what} copied.`);
  };

  const active = key?.status === 'active' && !!key.ingest_endpoints;
  const rtmp = forDevice(key?.ingest_endpoints?.rtmp);
  const whip = forDevice(key?.ingest_endpoints?.webrtc);
  const playback = active ? forDevice(key?.playback_url) : null;
  const obs = rtmp ? splitRtmp(rtmp) : null;
  const ffmpeg = useMemo(() => (rtmp ? `ffmpeg -re -i input.mp4 -c:v libx264 -preset veryfast -tune zerolatency -c:a aac -f flv ${rtmp}` : ''), [rtmp]);

  if (user && !CAN_BROADCAST.has(user.role)) {
    return (
      <Screen title="Go live" back testID="broadcast-screen">
        <InfoBanner message="Broadcasting is available to players and league organizers. You can still watch live streams and co-streams." testID="broadcast-not-allowed" />
      </Screen>
    );
  }

  return (
    <Screen title="Go live" subtitle="Stream with OBS, FFmpeg or a WHIP app" back testID="broadcast-screen">
      <Card testID="broadcast-key-card">
        <View style={styles.headRow}>
          <Text style={text.title} accessibilityRole="header">
            Stream key
          </Text>
          <StatusPill
            kind={active ? 'live' : key?.status === 'revoked' ? 'cancelled' : 'pending'}
            label={active ? 'ACTIVE' : key?.status === 'revoked' ? 'REVOKED' : 'NO KEY'}
            testID="broadcast-key-status"
          />
        </View>
        <Field
          label="Broadcasting player ID"
          testID="broadcast-player-id"
          value={playerId}
          onChangeText={setPlayerId}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!user?.player_id || user.role !== 'player'}
          placeholder="player-alpha-1"
        />
        <Field label="Key label (for your own reference)" testID="broadcast-label" value={label} onChangeText={setLabel} maxLength={64} autoCapitalize="none" />
        {error ? <ErrorBanner message={error} testID="broadcast-error" /> : null}
        {active ? (
          <View style={styles.btnRow}>
            <SecondaryButton title="Rotate key" icon="sync" onPress={() => run('rotate')} loading={busy === 'rotate'} disabled={!!busy} testID="broadcast-rotate" style={{ flex: 1 }} accessibilityHint="Issues a new key and cuts off the old one" />
            <SecondaryButton title="Revoke key" icon="ban" danger onPress={() => setConfirmRevoke(true)} disabled={!!busy} testID="broadcast-revoke" style={{ flex: 1 }} />
          </View>
        ) : (
          <PrimaryButton
            title={key?.status === 'revoked' ? 'Get a new key' : 'Go live: get a stream key'}
            icon="videocam"
            onPress={() => run(key?.status === 'revoked' ? 'rotate' : 'generate')}
            loading={busy === 'generate' || busy === 'rotate'}
            testID="broadcast-generate"
          />
        )}
      </Card>

      {active && key ? (
        <>
          <SectionTitle>Ingest addresses</SectionTitle>
          <Card testID="broadcast-ingest">
            <CopyRow label="RTMP server (OBS: Server)" value={obs?.server ?? ''} onCopy={copy} testID="ingest-rtmp-server" />
            <CopyRow
              label="Stream key (OBS: Stream key)"
              value={key.stream_key}
              display={showKey ? key.stream_key : maskKey(key.stream_key)}
              onCopy={copy}
              testID="ingest-stream-key"
              extra={
                <Pressable
                  testID="ingest-key-toggle"
                  accessibilityRole="button"
                  accessibilityLabel={showKey ? 'Hide stream key' : 'Show stream key'}
                  onPress={() => setShowKey((v) => !v)}
                  style={styles.iconBtn}
                >
                  <Icon name={showKey ? 'eye-off' : 'eye'} size={20} color={colors.text} />
                </Pressable>
              }
            />
            <CopyRow label="Full RTMP URL (FFmpeg)" value={rtmp ?? ''} display={showKey ? rtmp ?? '' : (obs?.server ?? '') + '/' + maskKey(key.stream_key)} onCopy={copy} testID="ingest-rtmp-url" />
            <CopyRow label="WebRTC WHIP URL" value={whip ?? ''} display={showKey ? whip ?? '' : (whip ?? '').replace(key.stream_key, maskKey(key.stream_key))} onCopy={copy} testID="ingest-whip-url" />
            <CopyRow label="FFmpeg command" value={ffmpeg} display="ffmpeg -re -i input.mp4 … -f flv <RTMP URL>" onCopy={copy} testID="ingest-ffmpeg" last />
            <Text style={[text.small, { marginTop: spacing.sm }]}>
              Keep the key private. Rotating or revoking it stops any broadcast that uses it within two seconds.
            </Text>
          </Card>
        </>
      ) : null}

      <SectionTitle>Preview</SectionTitle>
      <HlsPlayer
        url={playback}
        testID="broadcast-preview"
        label="Preview of your live stream"
        idleMessage={active ? 'Start streaming from OBS or FFmpeg to see the preview.' : 'Get a stream key to see the preview here.'}
      >
        <ScoreOverlay score={overlay.score} matchId={matchId} />
        <ProductOverlay product={overlay.product} />
      </HlsPlayer>
      <Text style={[text.small, { marginBottom: spacing.sm }]} testID="broadcast-feed-mode">
        Overlay: {feedLabel(overlay.mode)}
      </Text>

      <SectionTitle>Score overlay match</SectionTitle>
      {matches.length ? (
        <View style={styles.chips} accessibilityRole="radiogroup">
          {matches.map((m) => (
            <Chip
              key={m.match_id}
              label={`${m.home_name} vs ${m.away_name}`}
              selected={matchId === m.match_id}
              onPress={() => setMatchId(m.match_id)}
              testID={`broadcast-match-${m.match_id}`}
            />
          ))}
        </View>
      ) : null}
      <Field label="Match ID" testID="broadcast-match-id" value={matchId} onChangeText={setMatchId} autoCapitalize="none" autoCorrect={false} />

      <ConfirmDialog
        visible={confirmRevoke}
        title="Revoke this stream key?"
        message="Any broadcast using it stops within two seconds, and the key can never be used again. You can get a new key afterwards."
        confirmTitle="Revoke key"
        destructive
        onCancel={() => setConfirmRevoke(false)}
        onConfirm={() => {
          setConfirmRevoke(false);
          run('revoke');
        }}
        testID="broadcast-revoke-confirm"
      />
    </Screen>
  );
}

function maskKey(k: string) {
  return k.length > 12 ? `${k.slice(0, 8)}••••••${k.slice(-4)}` : '••••••';
}

function CopyRow({
  label,
  value,
  display,
  onCopy,
  testID,
  extra,
  last,
}: {
  label: string;
  value: string;
  display?: string;
  onCopy: (v: string, what: string) => void;
  testID: string;
  extra?: React.ReactNode;
  last?: boolean;
}) {
  return (
    <View style={[styles.copyRow, !last && styles.divider]}>
      <View style={{ flex: 1 }}>
        <Text style={text.small}>{label}</Text>
        <Text style={styles.mono} testID={testID} selectable numberOfLines={3}>
          {display ?? value}
        </Text>
      </View>
      {extra}
      <Pressable
        testID={`${testID}-copy`}
        accessibilityRole="button"
        accessibilityLabel={`Copy ${label}`}
        onPress={() => onCopy(value, label.replace(/ \(.*\)$/, ''))}
        style={styles.iconBtn}
      >
        <Icon name="copy-outline" size={20} color={colors.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  btnRow: { flexDirection: 'row', gap: spacing.sm },
  copyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  mono: { color: colors.text, fontSize: 13, fontFamily: 'monospace', marginTop: 2 },
  iconBtn: { width: TOUCH, height: TOUCH, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cardHi },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
});
