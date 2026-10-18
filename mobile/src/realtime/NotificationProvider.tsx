// Real-time notifications (FR-5.2): a banner at the top of the screen for live score updates,
// match start / end, co-stream invites and order status changes that arrive over WebSocket / SSE.
// The same events are also posted as local system notifications (see localNotify.ts).
// Matches the user opens are "watched" for the rest of the session (up to 3), so a goal still
// shows a banner after the user has moved to another screen. Signed-in users also get their own
// order status changes from ws://<server>/ws/users/me?token=<jwt>.
import { router } from 'expo-router';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getToken } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Icon, IconName } from '../components/Icon';
import { colors, radius, spacing, TOUCH } from '../theme';
import { initLocalNotifications, onNotificationTap, showLocalNotification } from './localNotify';
import { subscribeMatch } from './matchFeed';
import { readScore } from './score';
import { wsUrl } from './urls';

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
const USER_WS_RETRY_MAX_MS = 30000;

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState<LiveNotice | null>(null);
  const [watched, setWatched] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { user } = useAuth();

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
  // Real-time events: in-app banner plus a local system notification.
  const alert = useCallback(
    (n: LiveNotice) => {
      notify(n);
      showLocalNotification(n.title, n.message, n.route).catch(() => {});
    },
    [notify],
  );

  // Permission is requested once (after sign-in, or on the first live event for guests, so a
  // cold-start deep link is never covered by the system dialog). Tapping a notification opens it.
  const signedIn = !!user;
  useEffect(() => {
    if (signedIn) initLocalNotifications().catch(() => {});
  }, [signedIn]);
  useEffect(() => {
    return onNotificationTap((r) => {
      try {
        router.push(r as any);
      } catch {
        // navigation not ready yet
      }
    });
  }, []);

  // One feed per watched match. A change in score (not the first snapshot) raises a banner.
  const key = watched.join(',');
  useEffect(() => {
    if (!watched.length) return;
    const last = new Map<string, string>();
    const lastStatus = new Map<string, string>();
    // Match start / end: the first status seen is remembered silently, later changes raise a notice.
    const onStatus = (id: string, status: unknown) => {
      if (typeof status !== 'string' || !status) return;
      const prev = lastStatus.get(id);
      lastStatus.set(id, status);
      if (prev === undefined || prev === status) return;
      const title = status === 'in_progress' ? 'Match started' : status === 'completed' ? 'Full time' : 'Match update';
      const message =
        status === 'in_progress'
          ? `${prettyId(id)} has kicked off.`
          : status === 'completed'
            ? `${prettyId(id)} has ended.`
            : `${prettyId(id)} is now ${status.replace(/_/g, ' ')}.`;
      alert({ kind: 'score', title, message, route: `/entity/${id}` });
    };
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
            alert({ kind: 'score', title: 'Score update', message: `${prettyId(id)} is now ${s.home} - ${s.away}.`, route: `/entity/${id}` });
          }
          onStatus(id, s.status);
        } else if (e.type === 'status') {
          onStatus(id, e.data?.status);
        } else if (e.type === 'costream_invite' || e.type === 'invite') {
          const sid = e.data?.session_id ?? e.data?.sessionId;
          alert({
            kind: 'invite',
            title: 'Co-stream invite',
            message: sid ? `You are invited to join ${sid}.` : 'You are invited to join a co-stream.',
            route: sid ? `/stream/${sid}` : undefined,
          });
        }
      }),
    );
    return () => subs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, alert]);

  // The signed-in user's own order status changes. Reconnects with back-off; a rejected token
  // (close code 4401 / 4403) stops retrying until the user signs in again.
  const userId = user?.user_id ?? null;
  useEffect(() => {
    if (!userId) return;
    let closed = false;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const connect = () => {
      const token = getToken();
      if (closed || !token) return;
      try {
        ws = new WebSocket(wsUrl(`/ws/users/me?token=${encodeURIComponent(token)}`));
      } catch {
        ws = null;
        schedule();
        return;
      }
      ws.onmessage = (ev) => {
        let msg: any;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg?.type === 'subscribed') attempts = 0;
        if (msg?.type !== 'order_status' || !msg.data) return;
        const d = msg.data;
        const to = String(d.to ?? d.status ?? 'updated').replace(/_/g, ' ');
        const orderId = typeof d.order_id === 'string' ? d.order_id : null;
        alert({
          kind: 'order',
          title: 'Order update',
          message: orderId ? `Order ${orderId} is now ${to}.` : `Your order is now ${to}.`,
          route: orderId ? `/receipt/${orderId}` : undefined,
        });
      };
      ws.onerror = () => {
        // onclose follows and schedules the retry
      };
      ws.onclose = (ev) => {
        ws = null;
        if (closed || ev?.code === 4401 || ev?.code === 4403) return;
        schedule();
      };
    };
    const schedule = () => {
      if (closed || retry) return;
      const delay = Math.min(USER_WS_RETRY_MAX_MS, 1000 * 2 ** Math.min(attempts, 5));
      attempts += 1;
      retry = setTimeout(() => {
        retry = null;
        connect();
      }, delay);
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      if (ws) {
        ws.onclose = null;
        ws.onmessage = null;
        ws.onerror = null;
        try {
          ws.close();
        } catch {
          // already closed
        }
      }
    };
  }, [userId, alert]);

  const value = useMemo(() => ({ notify, watchMatch }), [notify, watchMatch]);
  return (
    <NotifyCtx.Provider value={value}>
      {children}
      {current ? (
        <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + spacing.sm }]}>
          {/* The open and close targets are siblings (never a button inside a button). */}
          <View style={styles.banner}>
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
              style={({ pressed }) => [styles.bannerBody, pressed && { opacity: 0.85 }]}
            >
              <View style={styles.iconWrap}>
                <Icon name={ICON[current.kind]} size={20} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title} testID="live-notification-title">{current.title}</Text>
                <Text style={styles.msg} testID="live-notification-message">{current.message}</Text>
              </View>
            </Pressable>
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
          </View>
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
  bannerBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: TOUCH },
  iconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accentBg, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: 15, fontFamily: 'Inter_700Bold' },
  msg: { color: colors.text, fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 2 },
  close: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
});
