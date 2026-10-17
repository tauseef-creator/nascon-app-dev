// Short success / info / error messages at the bottom of the screen.
import { Ionicons } from '@expo/vector-icons';
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, spacing } from '../theme';

type Tone = 'success' | 'error' | 'info';
type ToastFn = (message: string, tone?: Tone) => void;
const Ctx = createContext<ToastFn>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ message: string; tone: Tone } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const show = useCallback<ToastFn>((message, tone = 'success') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, tone });
    timer.current = setTimeout(() => setToast(null), 4000);
  }, []);
  const map = {
    success: { bg: '#1E4D2B', icon: 'checkmark-circle' as const },
    error: { bg: '#7A1E1A', icon: 'alert-circle' as const },
    info: { bg: '#2C2C2E', icon: 'information-circle' as const },
  };
  return (
    <Ctx.Provider value={show}>
      {children}
      {toast ? (
        <View pointerEvents="none" style={[styles.wrap, { bottom: insets.bottom + 84 }]}>
          <View
            testID="toast"
            style={[styles.toast, { backgroundColor: map[toast.tone].bg }]}
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
          >
            <Ionicons name={map[toast.tone].icon} size={22} color="#fff" />
            <Text style={styles.text}>{toast.message}</Text>
          </View>
        </View>
      ) : null}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.lg, right: spacing.lg, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    maxWidth: 520,
    width: '100%',
    elevation: 6,
  },
  text: { color: '#fff', fontSize: 16, fontFamily: 'Inter_600SemiBold', flex: 1 },
});
