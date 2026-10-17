// Always-visible connection + sync indicator (text + icon, never colour alone).
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSync } from '../offline/SyncProvider';
import { colors, spacing } from '../theme';

export function SyncBar() {
  const { online, serverDown, syncing, pending } = useSync();
  let icon: React.ComponentProps<typeof Ionicons>['name'] = 'cloud-done';
  let label = 'Online';
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
    label = 'Server unreachable';
    tint = colors.warning;
  }
  const pendingText = pending > 0 ? `${pending} pending` : 'All synced';
  const a11y = `Connection: ${label}. ${pending > 0 ? `${pending} actions waiting to sync` : 'Nothing waiting to sync'}. Opens the sync queue.`;
  return (
    <Pressable
      testID="sync-bar"
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={() => router.push('/sync')}
      hitSlop={{ top: 4, bottom: 4 }}
      style={({ pressed }) => [styles.bar, pressed && { backgroundColor: 'rgba(255,255,255,0.16)' }]}
    >
      <View style={styles.left}>
        {syncing ? <ActivityIndicator size="small" color={tint} /> : <Ionicons name={icon} size={17} color={tint} />}
        <Text testID="sync-status" style={[styles.text, { color: tint }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <View style={styles.right}>
        <Ionicons name={pending > 0 ? 'cloud-upload' : 'checkmark-done'} size={16} color={pending > 0 ? colors.warning : colors.textMuted} />
        <Text testID="sync-pending" style={styles.text} numberOfLines={1}>
          {pendingText}
        </Text>
        <Ionicons name="chevron-forward" size={15} color={colors.textMuted} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 34,
    marginHorizontal: spacing.lg,
    marginTop: spacing.xs,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  text: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
});
