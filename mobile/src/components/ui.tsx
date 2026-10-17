// Shared building blocks. Every interactive element has testID, accessibilityRole,
// and a minimum 48 dp touch target.
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { useBrand } from '../auth/AuthContext';
import { colors, font, radius, shadow, spacing, text, TOUCH } from '../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export function Card({ children, style, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <View testID={testID} style={[styles.card, style]}>
      {children}
    </View>
  );
}

export function PressableCard({
  children,
  onPress,
  testID,
  label,
  style,
}: {
  children: React.ReactNode;
  onPress: () => void;
  testID: string;
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85, backgroundColor: '#242A35' }, style]}
    >
      {children}
    </Pressable>
  );
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  testID: string;
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  compact?: boolean;
};

export function PrimaryButton({ title, onPress, testID, loading, disabled, icon, style, accessibilityLabel, accessibilityHint, compact }: ButtonProps) {
  const off = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        compact && styles.btnCompact,
        { backgroundColor: off ? '#9CA3AF' : colors.ink },
        pressed && !off && { opacity: 0.85 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.white} />
      ) : icon ? (
        <Ionicons name={icon} size={20} color={colors.white} />
      ) : null}
      <Text style={[styles.btnText, { color: colors.white }]} numberOfLines={2}>
        {loading ? 'Please wait…' : title}
      </Text>
    </Pressable>
  );
}

export function SecondaryButton({ title, onPress, testID, loading, disabled, icon, style, accessibilityLabel, accessibilityHint, compact, danger }: ButtonProps & { danger?: boolean }) {
  const brand = useBrand();
  const off = disabled || loading;
  const fg = off ? '#6B7280' : danger ? colors.danger : brand.primaryText;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        compact && styles.btnCompact,
        { backgroundColor: colors.card, borderWidth: 1, borderColor: off ? colors.border : colors.border },
        pressed && !off && { backgroundColor: '#242A35' },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={20} color={fg} /> : null}
      <Text style={[styles.btnText, { color: fg }]} numberOfLines={2}>
        {title}
      </Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  testID,
  color = colors.text,
  badge,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  testID: string;
  color?: string;
  badge?: number;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge} item${badge === 1 ? '' : 's'}` : label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name={icon} size={26} color={color} />
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function EmptyState({
  icon = 'information-circle-outline',
  title,
  message,
  actionTitle,
  onAction,
  testID = 'empty-state',
}: {
  icon?: IconName;
  title: string;
  message?: string;
  actionTitle?: string;
  onAction?: () => void;
  testID?: string;
}) {
  return (
    <View testID={testID} style={styles.empty} accessible accessibilityLabel={`${title}. ${message ?? ''}`}>
      <Ionicons name={icon} size={48} color={colors.textMuted} />
      <Text style={[text.title, { textAlign: 'center', marginTop: spacing.md }]}>{title}</Text>
      {message ? <Text style={[text.muted, { textAlign: 'center', marginTop: spacing.sm }]}>{message}</Text> : null}
      {actionTitle && onAction ? (
        <PrimaryButton title={actionTitle} onPress={onAction} testID={`${testID}-action`} style={{ marginTop: spacing.lg, alignSelf: 'stretch' }} />
      ) : null}
    </View>
  );
}

export function ErrorBanner({ message, onRetry, testID = 'error-banner' }: { message: string; onRetry?: () => void; testID?: string }) {
  return (
    <View testID={testID} style={styles.errorBox} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
        <Ionicons name="alert-circle" size={24} color={colors.danger} accessibilityLabel="Problem" />
        <Text style={[text.body, { flex: 1, color: '#7F1D1D' }]}>{message}</Text>
      </View>
      {onRetry ? (
        <SecondaryButton title="Try again" icon="refresh" onPress={onRetry} testID={`${testID}-retry`} danger compact style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }} />
      ) : null}
    </View>
  );
}

export function InfoBanner({ message, icon = 'information-circle', tone = 'info', testID }: { message: string; icon?: IconName; tone?: 'info' | 'warning' | 'success'; testID?: string }) {
  const map = {
    info: { bg: colors.infoBg, fg: '#1E3A8A' },
    warning: { bg: colors.warningBg, fg: colors.warning },
    success: { bg: colors.successBg, fg: '#065F46' },
  }[tone];
  return (
    <View testID={testID} style={[styles.infoBox, { backgroundColor: map.bg }]} accessibilityRole="text">
      <Ionicons name={icon} size={22} color={map.fg} />
      <Text style={[text.body, { flex: 1, color: map.fg }]}>{message}</Text>
    </View>
  );
}

export function LoadingView({ label = 'Loading…' }: { label?: string }) {
  const brand = useBrand();
  return (
    <View style={styles.loading} accessibilityRole="progressbar" accessibilityLabel={label} testID="loading">
      <ActivityIndicator size="large" color={brand.primaryText} />
      <Text style={[text.muted, { marginTop: spacing.md }]}>{label}</Text>
    </View>
  );
}

export type PillKind = 'live' | 'ft' | 'upcoming' | 'clinched' | 'eliminated' | 'possible' | 'pending' | 'applied' | 'rejected' | 'duplicate' | 'corrected' | 'offline';

const PILL: Record<PillKind, { label: string; icon: IconName; bg: string; fg: string }> = {
  live: { label: 'LIVE', icon: 'radio-button-on', bg: colors.dangerBg, fg: colors.live },
  ft: { label: 'FT', icon: 'flag', bg: colors.neutralBg, fg: colors.textMuted },
  upcoming: { label: 'UPCOMING', icon: 'time-outline', bg: colors.infoBg, fg: colors.info },
  clinched: { label: 'CLINCHED', icon: 'checkmark-circle', bg: colors.successBg, fg: colors.success },
  eliminated: { label: 'OUT', icon: 'close-circle', bg: colors.dangerBg, fg: colors.danger },
  possible: { label: 'IN CONTENTION', icon: 'ellipse-outline', bg: colors.neutralBg, fg: colors.textMuted },
  pending: { label: 'PENDING', icon: 'cloud-upload-outline', bg: colors.warningBg, fg: colors.warning },
  applied: { label: 'APPLIED', icon: 'checkmark-circle', bg: colors.successBg, fg: colors.success },
  rejected: { label: 'REJECTED', icon: 'close-circle', bg: colors.dangerBg, fg: colors.danger },
  duplicate: { label: 'ALREADY SYNCED', icon: 'copy-outline', bg: colors.neutralBg, fg: colors.textMuted },
  corrected: { label: 'CORRECTED', icon: 'arrow-undo', bg: colors.warningBg, fg: colors.warning },
  offline: { label: 'SAVED COPY', icon: 'cloud-offline-outline', bg: colors.neutralBg, fg: colors.textMuted },
};

export function StatusPill({ kind, label, testID }: { kind: PillKind; label?: string; testID?: string }) {
  const p = PILL[kind];
  return (
    <View testID={testID} style={[styles.pill, { backgroundColor: p.bg }]} accessible accessibilityLabel={`Status: ${label ?? p.label}`}>
      <Ionicons name={p.icon} size={16} color={p.fg} />
      <Text style={[styles.pillText, { color: p.fg }]}>{label ?? p.label}</Text>
    </View>
  );
}

export function matchPill(status: string): PillKind {
  if (status === 'in_progress') return 'live';
  if (status === 'completed') return 'ft';
  return 'upcoming';
}

export function Chip({
  label,
  selected,
  onPress,
  testID,
  disabled,
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const brand = useBrand();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: !!disabled, checked: selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected ? { backgroundColor: '#1B2A43', borderColor: brand.primaryText } : { backgroundColor: colors.card, borderColor: colors.border },
        disabled && { opacity: 0.45 },
        pressed && { opacity: 0.8 },
      ]}
    >
      {selected ? <Ionicons name="checkmark" size={16} color={brand.primaryText} /> : null}
      <Text style={[styles.chipText, { color: selected ? colors.text : colors.textMuted }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Field({ label, testID, error, ...rest }: TextInputProps & { label: string; testID: string; error?: string | null }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={[text.label, { marginBottom: spacing.xs }]}>{label}</Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        placeholderTextColor="#6B7280"
        style={[styles.input, error ? { borderColor: colors.danger } : null]}
        {...rest}
      />
      {error ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
          <Ionicons name="alert-circle" size={16} color={colors.danger} />
          <Text style={{ color: colors.danger, fontSize: font.small }}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text style={[text.section, { marginTop: spacing.lg, marginBottom: spacing.sm }]} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Row({ label, value, testID }: { label: string; value: React.ReactNode; testID?: string }) {
  return (
    <View testID={testID} style={styles.row}>
      <Text style={[text.muted, { flexShrink: 0, marginRight: spacing.md }]}>{label}</Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text style={[text.label, { flex: 1, textAlign: 'right' }]}>{value}</Text>
      ) : (
        <View style={{ flex: 1, alignItems: 'flex-end' }}>{value}</View>
      )}
    </View>
  );
}

export function money(minor: number, currency = 'PKR') {
  const v = (minor / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency} ${v}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hh = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}, ${h12}:${mm} ${hh < 12 ? 'AM' : 'PM'}`;
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = d.getHours();
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(d.getMinutes()).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
}

export function CachedNotice({ updatedAt, testID = 'cached-notice' }: { updatedAt: string; testID?: string }) {
  return <InfoBanner testID={testID} icon="cloud-offline-outline" tone="warning" message={`You're seeing a saved copy from ${formatDateTime(updatedAt)}. It will refresh when you're back online.`} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
    ...shadow,
  },
  btn: {
    minHeight: TOUCH + 4,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  btnCompact: { minHeight: TOUCH, paddingHorizontal: spacing.md },
  btnText: { fontSize: 16, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  iconBtn: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 4,
    right: 2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  empty: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, paddingTop: spacing.xxl },
  errorBox: {
    backgroundColor: colors.dangerBg,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.danger,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, minHeight: 200 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  pillText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.4 },
  chip: {
    minHeight: TOUCH,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  chipText: { fontSize: font.body, fontWeight: '600' },
  input: {
    minHeight: TOUCH + 4,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: font.body,
    color: colors.text,
    backgroundColor: colors.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 40,
    paddingVertical: spacing.xs,
  },
});
