// Compact, always-visible connection + sync indicator for the header (spec 8.2 "Sync status").
// A cloud icon whose shape AND short label change with the state, so meaning never relies on colour:
//   Synced (cloud + check) · N pending (cloud + up arrow) · Syncing (spinner) · Offline (cloud + slash)
//   · No server (warning). Tapping opens the sync queue.
import { router } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSync } from '../offline/SyncProvider';
import { colors } from '../theme';
import { Icon, IconName } from './Icon';

/** `compact` hides the text label (icon shape + badge still show the state; used on back screens). */
export function SyncBar({ compact = false }: { compact?: boolean }) {
  const { online, serverDown, syncing, pending } = useSync();
  let icon: IconName = 'cloud-done';
  let label = 'Synced';
  let tint = colors.success;
  if (!online) {
    icon = 'cloud-offline';
    label = 'Offline';
    tint = colors.textMuted;
  } else if (syncing) {
    label = 'Syncing';
    tint = colors.info;
  } else if (serverDown) {
    icon = 'warning';
    label = 'No server';
    tint = colors.warning;
  } else if (pending > 0) {
    icon = 'cloud-upload';
    label = 'Pending';
    tint = colors.warning;
  }
  const a11y = `Connection: ${online ? (serverDown ? 'server unreachable' : 'online') : 'offline'}. ${
    pending > 0 ? `${pending} actions waiting to sync` : 'Nothing waiting to sync'
  }. Opens the sync queue.`;
  return (
    <Pressable
      testID="sync-bar"
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={() => router.push('/sync')}
      hitSlop={8}
      style={({ pressed }) => [styles.chip, compact && styles.compact, pressed && { opacity: 0.7 }]}
    >
      {syncing ? <ActivityIndicator size="small" color={tint} /> : <Icon name={icon} size={18} color={tint} />}
      {compact ? null : (
        <Text testID="sync-status" style={[styles.label, { color: tint }]} numberOfLines={1}>
          {label}
        </Text>
      )}
      {pending > 0 ? (
        <View style={[styles.badge, { backgroundColor: tint }]}>
          <Text testID="sync-pending" style={styles.badgeText}>
            {pending}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  compact: { paddingHorizontal: 9 },
  label: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  badge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.black, fontSize: 11, fontFamily: 'Inter_700Bold' },
});
