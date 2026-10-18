// Short success / info / error messages at the bottom of the screen.
import { Icon } from './Icon';
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, TOUCH } from '../theme';

type Tone = 'success' | 'error' | 'info';
type ToastAction = { label: string; onPress: () => void; accessibilityLabel?: string };
type ToastFn = (message: string, tone?: Tone, action?: ToastAction) => void;
const Ctx = createContext<ToastFn>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ message: string; tone: Tone; action?: ToastAction } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const show = useCallback<ToastFn>((message, tone = 'success', action) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, tone, action });
    timer.current = setTimeout(() => setToast(null), action ? 6000 : 4000);
  }, []);
  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
  }, []);
  const map = {
    success: { bg: '#1E4D2B', icon: 'checkmark-circle' as const },
    error: { bg: '#7A1E1A', icon: 'alert-circle' as const },
    info: { bg: colors.cardHi, icon: 'information-circle' as const },
  };
  return (
    <Ctx.Provider value={show}>
      {children}
      {toast ? (
        <View pointerEvents={toast.action ? 'box-none' : 'none'} style={[styles.wrap, { bottom: insets.bottom + 84 }]}>
          <View
            testID="toast"
            style={[styles.toast, { backgroundColor: map[toast.tone].bg }]}
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
          >
            <Icon name={map[toast.tone].icon} size={22} color="#fff" />
            <Text style={styles.text}>{toast.message}</Text>
            {toast.action ? (
              <Pressable
                testID="toast-action"
                accessibilityRole="button"
                accessibilityLabel={toast.action.accessibilityLabel ?? toast.action.label}
                onPress={() => {
                  const run = toast.action!.onPress;
                  dismiss();
                  run();
                }}
                style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.actionText}>{toast.action.label}</Text>
              </Pressable>
            ) : null}
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
  action: { minHeight: TOUCH, minWidth: TOUCH, paddingHorizontal: spacing.md, marginRight: -spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  actionText: { color: '#fff', fontSize: 15, fontFamily: 'Inter_700Bold', textDecorationLine: 'underline' },
});
