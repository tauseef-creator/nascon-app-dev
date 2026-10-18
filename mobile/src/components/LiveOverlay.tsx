// Live score + pinned merchandise overlay drawn over a video player (FR-3.2). Values come from
// the match feed (WebSocket, then SSE, then polling), so the video keeps playing while they change.
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';
import { Product } from '../api/types';
import { useNotify } from '../realtime/NotificationProvider';
import { FeedMode, useMatchFeed } from '../realtime/matchFeed';
import { LiveScore, readScore } from '../realtime/score';
import { colors, radius, spacing } from '../theme';
import { crestColor } from './ClubCrest';
import { money } from './ui';

export function useLiveOverlay(matchId: string | null) {
  const { notify } = useNotify();
  const [score, setScore] = useState<LiveScore | null>(null);
  const [product, setProduct] = useState<Product | null>(null);

  const loadScore = useCallback(async () => {
    if (!matchId) return;
    try {
      const s = readScore(await api(`/audit/v1/score/${encodeURIComponent(matchId)}`, { auth: false }));
      if (s) setScore(s);
    } catch {
      setScore(null);
    }
  }, [matchId]);
  const loadPinned = useCallback(async () => {
    if (!matchId) return;
    try {
      const r = await api<{ product: Product | null }>(`/api/v1/matches/${encodeURIComponent(matchId)}/pinned`);
      setProduct(r?.product ?? null);
    } catch {
      // Pinned products need sign-in on some servers; the overlay then shows the score only.
    }
  }, [matchId]);

  useEffect(() => {
    setScore(null);
    setProduct(null);
    loadScore();
    loadPinned();
  }, [loadScore, loadPinned]);

  const mode: FeedMode = useMatchFeed(matchId, (e) => {
    if (e.type === 'score' || e.type === 'snapshot') {
      const s = readScore(e.data);
      if (!s) return;
      // The socket's first frame also carries the pinned product.
      if (e.raw?.pinned_product && e.raw.pinned_product.product !== undefined) setProduct(e.raw.pinned_product.product);
      setScore((prev) => {
        if (prev && e.type === 'score' && (prev.home !== s.home || prev.away !== s.away)) {
          notify({ kind: 'score', title: 'Score update', message: `Live score is now ${s.home} - ${s.away}.` });
        }
        return s;
      });
    } else if (e.type === 'pinned_product' || e.type === 'pinned') {
      if (e.data?.product !== undefined) setProduct(e.data.product);
      else loadPinned();
    }
  });
  return { score, product, mode };
}

export function ScoreOverlay({ score, matchId }: { score: LiveScore | null; matchId: string }) {
  if (!score) return null;
  return (
    <View
      style={styles.score}
      testID="overlay-score"
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Live score ${score.home} to ${score.away}`}
    >
      <View style={[styles.badge, { backgroundColor: crestColor(score.homeId ?? 'home') }]} />
      <Text style={styles.scoreText} testID="overlay-score-text">
        {score.home} - {score.away}
      </Text>
      <View style={[styles.badge, { backgroundColor: crestColor(score.awayId ?? 'away') }]} />
      <Text style={styles.matchId} numberOfLines={1}>
        {score.status === 'in_progress' ? 'LIVE' : (score.status ?? '').replace(/_/g, ' ').toUpperCase() || matchId}
      </Text>
    </View>
  );
}

export function ProductOverlay({ product }: { product: Product | null }) {
  if (!product) return null;
  const v = product.variants?.[0];
  return (
    <View style={styles.product} testID="overlay-product" accessible accessibilityLabel={`Pinned product: ${product.name}${v ? `, ${money(v.price_minor, v.currency)}` : ''}`}>
      <Text style={styles.productLabel}>PINNED</Text>
      <Text style={styles.productName} numberOfLines={1}>
        {product.name}
      </Text>
      {v ? <Text style={styles.productPrice}>{money(v.price_minor, v.currency)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  score: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  badge: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)' },
  scoreText: { color: colors.white, fontSize: 16, fontFamily: 'Inter_800ExtraBold' },
  matchId: { color: colors.live, fontSize: 11, fontFamily: 'Inter_700Bold', marginLeft: 4 },
  product: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    maxWidth: '60%',
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  productLabel: { color: colors.accent, fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.6 },
  productName: { color: colors.white, fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  productPrice: { color: colors.white, fontSize: 12, fontFamily: 'Inter_400Regular' },
});
