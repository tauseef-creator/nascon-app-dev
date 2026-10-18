// In-app real-time notifications (FR-5.2): a banner at the top of the screen for live score
// updates, co-stream invites and new chat messages that arrive over WebSocket / SSE.
// Matches the user opens are "watched" for the rest of the session (up to 3), so a goal still
// shows a banner after the user has moved to another screen.
import { router } from 'expo-router';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, IconName } from '../components/Icon';
import { colors, radius, spacing, TOUCH } from '../theme';
import { subscribeMatch } from './matchFeed';
import { readScore } from './score';

export type LiveNotice = {
  kind: 'score' | 'invite' | 'chat' | 'order' | 'info';
  title: string;
  message: string;
  /** In-app route opened when the banner is tapped. */
  route?: string;
};

type Ctx = {
  notify: (n: LiveNotice) => void;
  watchMatch: (matchId: string) => void;
};

const NotifyCtx = createContext<Ctx>({ notify: () => {}, watchMatch: () => {} });
const ICON: Record<LiveNotice['kind'], IconName> = {
  score: 'pulse',
  invite: 'videocam',
  chat: 'chatbubbles',
  order: 'receipt-outline',
  info: 'notifications',
};
const MAX_WATCHED = 3;

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState<LiveNotice | null>(null);
  const [watched, setWatched] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((n: LiveNotice) => {
    if (timer.current) clearTimeout(timer.current);
    setCurrent(n);
    timer.current = setTimeout(() => setCurrent(null), 5000);
  }, []);
  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setCurrent(null);
  }, []);
  const watchMatch = useCallback((id: string) => {
    setWatched((w) => (w.includes(id) ? w : [id, ...w].slice(0, MAX_WATCHED)));
  }, []);

  // One feed per watched match. A change in score (not the first snapshot) raises a banner.
  const key = watched.join(',');
  useEffect(() => {
    if (!watched.length) return;
    const last = new Map<string, string>();
    const subs = watched.map((id) =>
      subscribeMatch(id, (e) => {
        if (e.type === 'score' || e.type === 'snapshot') {
          const s = readScore(e.data);
          if (!s) return;
          const sig = `${s.home}-${s.away}`;
          const prev = last.get(id);
          last.set(id, sig);
          // The first value after connecting is remembered silently; later changes raise a banner.
          if (prev !== undefined && prev !== sig) {
            notify({ kind: 'score', title: 'Score update', message: `${prettyId(id)} is now ${s.home} - ${s.away}.`, route: `/entity/${id}` });
          }
        } else if (e.type === 'costream_invite' || e.type === 'invite') {
          const sid = e.data?.session_id ?? e.data?.sessionId;
          notify({
            kind: 'invite',
            title: 'Co-stream invite',
            message: sid ? `You are invited to join ${sid}.` : 'You are invited to join a co-stream.',
            route: sid ? `/stream/${sid}` : undefined,
          });
        } else if (e.type === 'order_status') {
          notify({ kind: 'order', title: 'Order update', message: `Your order is now ${String(e.data?.status ?? 'updated').replace(/_/g, ' ')}.` });
        }
      }),
    );
    return () => subs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, notify]);

  const value = useMemo(() => ({ notify, watchMatch }), [notify, watchMatch]);
  return (
    <NotifyCtx.Provider value={value}>
      {children}
      {current ? (
        <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + spacing.sm }]}>
          <Pressable
            testID="live-notification"
            accessibilityRole={current.route ? 'button' : 'alert'}
            accessibilityLiveRegion="polite"
            accessibilityLabel={`${current.title}. ${current.message}${current.route ? ' Double tap to open.' : ''}`}
            onPress={() => {
              const r = current.route;
              dismiss();
              if (r) router.push(r as any);
            }}
            style={({ pressed }) => [styles.banner, pressed && { opacity: 0.85 }]}
          >
            <View style={styles.iconWrap}>
              <Icon name={ICON[current.kind]} size={20} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} testID="live-notification-title">{current.title}</Text>
              <Text style={styles.msg} testID="live-notification-message">{current.message}</Text>
            </View>
            <Pressable
              testID="live-notification-close"
              accessibilityRole="button"
              accessibilityLabel="Dismiss notification"
              onPress={dismiss}
              hitSlop={8}
              style={styles.close}
            >
              <Icon name="close" size={18} color={colors.textMuted} />
            </Pressable>
          </Pressable>
        </View>
      ) : null}
    </NotifyCtx.Provider>
  );
}

export const useNotify = () => useContext(NotifyCtx);

function prettyId(id: string) {
  return id.replace(/^match-/, 'Match ').replace(/-/g, ' ');
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.md, right: spacing.md, alignItems: 'center' },
  banner: {
    width: '100%',
    maxWidth: 560,
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.cardHi,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(48,209,88,0.4)',
    elevation: 8,
  },
  iconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accentBg, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: 15, fontFamily: 'Inter_700Bold' },
  msg: { color: colors.text, fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 2 },
  close: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
});
