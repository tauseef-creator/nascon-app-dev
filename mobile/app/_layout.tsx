import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/auth/AuthContext';
import { LoadingView } from '../src/components/ui';
import { ToastProvider } from '../src/components/Toast';
import { SyncProvider } from '../src/offline/SyncProvider';
import { CartProvider } from '../src/store/CartContext';
import { LeagueProvider } from '../src/store/LeagueContext';
import { colors } from '../src/theme';

const PUBLIC = new Set(['login', 'settings']);

function Gate() {
  const { ready, user } = useAuth();
  const segments = useSegments();
  const first = (segments[0] as string | undefined) ?? '';

  useEffect(() => {
    if (!ready) return;
    if (!user && !PUBLIC.has(first)) router.replace('/login');
    else if (user && first === 'login') router.replace('/');
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
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AuthProvider>
        <SyncProvider>
          <ToastProvider>
            <LeagueProvider>
              <CartProvider>
                <Gate />
              </CartProvider>
            </LeagueProvider>
          </ToastProvider>
        </SyncProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
