// HLS (.m3u8) player built on expo-video. Children render as an overlay on top of the video
// (live score, pinned product), so overlays update without restarting the media stream.
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../theme';
import { Icon } from './Icon';

const RETRY_MS = 4000;

type Props = {
  url: string | null;
  testID?: string;
  /** Accessible description of what is playing. */
  label: string;
  /** Shown when there is no URL yet. */
  idleMessage?: string;
  children?: React.ReactNode;
};

export function HlsPlayer({ url, testID = 'hls-player', label, idleMessage = 'No stream yet.', children }: Props) {
  return (
    <View style={styles.frame} testID={testID} accessible={false}>
      {url ? <Player key={url} url={url} label={label} /> : <Idle message={idleMessage} />}
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        {children}
      </View>
    </View>
  );
}

function Player({ url, label }: { url: string; label: string }) {
  const player = useVideoPlayer({ uri: url, contentType: 'hls' }, (p) => {
    p.muted = true;
    p.loop = false;
    p.play();
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  // A stream that is not live yet fails to load; try again every few seconds so the video starts
  // as soon as the broadcaster goes live, without the user reopening the screen.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (status !== 'error') return;
    const t = setTimeout(() => {
      setAttempt((a) => a + 1);
      player
        .replaceAsync({ uri: url, contentType: 'hls' })
        .then(() => player.play())
        .catch(() => {});
    }, RETRY_MS);
    return () => clearTimeout(t);
  }, [status, player, url, attempt]);
  return (
    <>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls
        accessibilityLabel={label}
      />
      {status === 'error' || status === 'loading' ? (
        <View pointerEvents="none" style={styles.statusWrap}>
          <Text style={styles.status} testID="hls-status">
            {status === 'error'
              ? 'Waiting for the stream. It plays as soon as the broadcaster is live.'
              : 'Loading stream…'}
          </Text>
        </View>
      ) : null}
    </>
  );
}

function Idle({ message }: { message: string }) {
  return (
    <View style={styles.idle}>
      <Icon name="videocam-outline" size={32} color={colors.textMuted} />
      <Text style={styles.status} testID="hls-idle">
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#0A0A0B', borderRadius: radius.md, overflow: 'hidden', marginBottom: spacing.md },
  idle: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  statusWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  status: { color: colors.text, fontSize: 14, fontFamily: 'Inter_600SemiBold', textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm, overflow: 'hidden' },
});
