// Live video for an in-progress match (FR-3.2): HLS from the media server with the live score and pinned
// merchandise drawn over the player from WebSocket/SSE metadata, so the stream never restarts.
import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { api } from '../api/client';
import { feedLabel } from '../realtime/matchFeed';
import { serverHost } from '../realtime/urls';
import { spacing, text } from '../theme';
import { HlsPlayer } from './HlsPlayer';
import { ProductOverlay, ScoreOverlay, useLiveOverlay } from './LiveOverlay';
import { SectionTitle } from './ui';

type GuestMatch = { stream?: { hls_path?: string | null; hls_port?: number; live?: boolean } };

const POLL_MS = 8000;

export function MatchLiveVideo({ matchId }: { matchId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const overlay = useLiveOverlay(url ? matchId : null);

  // The broadcaster can go on or off air at any time, so the stream lookup is polled.
  useEffect(() => {
    let alive = true;
    const load = () => {
      api<GuestMatch>(`/api/v1/guest/matches/${encodeURIComponent(matchId)}`, { auth: false })
        .then((m) => {
          if (!alive) return;
          const s = m?.stream;
          setUrl(s?.live && s.hls_path ? `http://${serverHost()}:${s.hls_port ?? 8888}/${s.hls_path}/index.m3u8` : null);
        })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [matchId]);

  return (
    <>
      <SectionTitle>Live stream</SectionTitle>
      <HlsPlayer url={url} testID="match-live-video" label="Live match stream" idleMessage="No one is broadcasting this match right now.">
        <ScoreOverlay score={overlay.score} matchId={matchId} />
        <ProductOverlay product={overlay.product} />
      </HlsPlayer>
      {url ? (
        <Text style={[text.small, { marginBottom: spacing.sm }]} testID="match-live-video-feed">
          Overlay: {feedLabel(overlay.mode)}
        </Text>
      ) : null}
    </>
  );
}
