// Local system notifications (FR-5.2): live score updates, co-stream invites and order status
// changes that arrive over WebSocket / SSE are also posted to the phone's notification shade, so
// the user still sees them when the app is in the background. Local only: no Firebase, no remote push.
// On web, or if the native module is missing from the installed build, every call is a safe no-op.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

type NotificationsModule = typeof import('expo-notifications');

const CHANNEL_ID = 'live-updates';
const ASKED_KEY = 'nascon.notificationsAsked';

let mod: NotificationsModule | null | undefined;
let ready: Promise<boolean> | null = null;

function load(): NotificationsModule | null {
  if (mod !== undefined) return mod;
  if (Platform.OS === 'web') return (mod = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('expo-notifications') as NotificationsModule;
  } catch {
    mod = null;
  }
  return mod;
}

/**
 * Sets the handler and the Android channel, and asks for permission the first time only.
 * Resolves true when notifications may be shown. Never rejects.
 */
export function initLocalNotifications(): Promise<boolean> {
  if (ready) return ready;
  ready = (async () => {
    const N = load();
    if (!N) return false;
    try {
      // In the foreground the in-app banner already shows the event, so the system copy goes
      // straight to the notification list without a second heads-up banner or sound.
      N.setNotificationHandler({
        handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
      });
      if (Platform.OS === 'android') {
        await N.setNotificationChannelAsync(CHANNEL_ID, { name: 'Live matches and orders', importance: N.AndroidImportance.HIGH });
      }
      const current = await N.getPermissionsAsync();
      if (current.granted) return true;
      const asked = await AsyncStorage.getItem(ASKED_KEY).catch(() => null);
      if (asked || !current.canAskAgain) return false;
      await AsyncStorage.setItem(ASKED_KEY, '1').catch(() => {});
      const res = await N.requestPermissionsAsync();
      return !!res.granted;
    } catch {
      return false;
    }
  })();
  return ready;
}

/** Posts a local notification now. `route` is opened in the app when the notification is tapped. */
export async function showLocalNotification(title: string, body: string, route?: string): Promise<void> {
  const N = load();
  if (!N) return;
  try {
    if (!(await initLocalNotifications())) return;
    await N.scheduleNotificationAsync({
      content: { title, body, data: route ? { route } : {} },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
    });
  } catch {
    // A failed system notification must never break the live feed.
  }
}

/** Calls `onRoute` when the user taps one of our notifications. Returns the unsubscribe function. */
export function onNotificationTap(onRoute: (route: string) => void): () => void {
  const N = load();
  if (!N) return () => {};
  try {
    const sub = N.addNotificationResponseReceivedListener((r) => {
      const route = r?.notification?.request?.content?.data?.route;
      if (typeof route === 'string' && route.startsWith('/')) onRoute(route);
    });
    return () => sub.remove();
  } catch {
    return () => {};
  }
}
