import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, useFonts } from '@expo-google-fonts/inter';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/auth/AuthContext';
import { LoadingView } from '../src/components/ui';
import { ToastProvider } from '../src/components/Toast';
import { SyncProvider } from '../src/offline/SyncProvider';
import { NotificationProvider } from '../src/realtime/NotificationProvider';
import { CartProvider } from '../src/store/CartContext';
import { LeagueProvider } from '../src/store/LeagueContext';
import { colors } from '../src/theme';

// Routes that work signed out. Deep links (nascon://entity/{id}, nascon://stream/{id}, spec 6.3)
// and the QR scanner open read-only guest views instead of stopping on the login screen.
const PUBLIC = new Set(['login', 'settings', 'entity', 'stream', 'scan']);

function Gate() {
  const { ready, user } = useAuth();
  const segments = useSegments();
  const first = (segments[0] as string | undefined) ?? '';

  useEffect(() => {
    if (!ready) return;
    if (!user && !PUBLIC.has(first)) router.replace('/login');
    else if (user && first === 'login') {
      // Signed in from a guest view (chat, follow): return there; otherwise go home.
      if (router.canGoBack()) router.back();
      else router.replace('/');
    }
  }, [ready, user, first]);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <LoadingView label="Starting NaSCon League…" />
      </View>
    );
  }
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="login" options={{ animation: 'fade' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold });
  if (!fontsLoaded && !fontError) return null;
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AuthProvider>
        <SyncProvider>
          <ToastProvider>
            <NotificationProvider>
              <LeagueProvider>
                <CartProvider>
                  <Gate />
                </CartProvider>
              </LeagueProvider>
            </NotificationProvider>
          </ToastProvider>
        </SyncProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
