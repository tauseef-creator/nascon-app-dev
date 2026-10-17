// Always-visible connection + sync indicator (text + icon, never colour alone).
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSync } from '../offline/SyncProvider';

export function SyncBar() {
  const { online, serverDown, syncing, pending } = useSync();
  let icon: React.ComponentProps<typeof Ionicons>['name'] = 'cloud-done';
  let label = 'Online';
  let bg = '#065F46';
  if (!online) {
    icon = 'cloud-offline';
    label = 'Offline';
    bg = '#374151';
  } else if (syncing) {
    label = 'Syncing';
    bg = '#1E40AF';
  } else if (serverDown) {
    icon = 'warning';
    label = 'Server unreachable';
    bg = '#92400E';
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
      style={({ pressed }) => [styles.bar, { backgroundColor: bg }, pressed && { opacity: 0.9 }]}
    >
      <View style={styles.left}>
        {syncing ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name={icon} size={18} color="#fff" />}
        <Text testID="sync-status" style={styles.text} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <View style={styles.right}>
        <Ionicons name={pending > 0 ? 'cloud-upload' : 'checkmark-done'} size={18} color="#fff" />
        <Text testID="sync-pending" style={styles.text} numberOfLines={1}>
          {pendingText}
        </Text>
        <Ionicons name="chevron-forward" size={16} color="#fff" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 40,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  text: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
