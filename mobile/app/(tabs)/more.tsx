import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { canManageRoster, ROLE_LABEL, useAuth, useBrand } from '../../src/auth/AuthContext';
import { ConfirmDialog } from '../../src/components/ConfirmDialog';
import { Screen, TenantLogo } from '../../src/components/Screen';
import { Card, PressableCard, Row, SectionTitle } from '../../src/components/ui';
import { useSync } from '../../src/offline/SyncProvider';
import { useCart } from '../../src/store/CartContext';
import { colors, spacing, text } from '../../src/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function LinkRow({ icon, title, detail, onPress, testID }: { icon: IconName; title: string; detail?: string; onPress: () => void; testID: string }) {
  return (
    <PressableCard testID={testID} label={detail ? `${title}. ${detail}` : title} onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Ionicons name={icon} size={26} color={colors.text} />
        <View style={{ flex: 1 }}>
          <Text style={text.label}>{title}</Text>
          {detail ? <Text style={text.small}>{detail}</Text> : null}
        </View>
        <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
      </View>
    </PressableCard>
  );
}

export default function More() {
  const { user, tenant, logout } = useAuth();
  const brand = useBrand();
  const sync = useSync();
  const cart = useCart();
  const [confirm, setConfirm] = useState(false);
  if (!user) return null;

  return (
    <Screen title="More" testID="more-screen">
      <Card testID="profile-card">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm }}>
          <TenantLogo size={48} />
          <View style={{ flex: 1 }}>
            <Text style={text.title}>{user.display_name}</Text>
            <Text style={text.small}>{user.email}</Text>
          </View>
        </View>
        <Row label="Role" value={ROLE_LABEL[user.role] ?? user.role} testID="profile-role" />
        <Row label="Organisation" value={tenant?.name ?? brand.tenantName} />
      </Card>

      <SectionTitle>App</SectionTitle>
      <LinkRow
        icon="cloud-upload-outline"
        title="Sync queue"
        detail={sync.pending ? `${sync.pending} action${sync.pending === 1 ? '' : 's'} waiting to sync` : 'Everything is synced'}
        onPress={() => router.push('/sync')}
        testID="more-sync"
      />
      {canManageRoster(user.role) && user.club_id ? (
        <LinkRow icon="people-outline" title="Manage roster" detail="Transfer, loan or release players" onPress={() => router.push('/roster')} testID="more-roster" />
      ) : null}
      {cart.lastOrder ? (
        <LinkRow icon="receipt-outline" title="Last receipt" detail={`Order ${cart.lastOrder.order_id.slice(0, 8)}…`} onPress={() => router.push(`/receipt/${cart.lastOrder!.order_id}`)} testID="more-receipt" />
      ) : null}
      <LinkRow icon="settings-outline" title="Settings" detail="Server address and device details" onPress={() => router.push('/settings')} testID="more-settings" />

      <SectionTitle>Account</SectionTitle>
      <LinkRow icon="log-out-outline" title="Sign out" onPress={() => setConfirm(true)} testID="more-logout" />

      <ConfirmDialog
        visible={confirm}
        title="Sign out?"
        message={
          sync.pending
            ? `You have ${sync.pending} action${sync.pending === 1 ? '' : 's'} waiting to sync. They stay saved on this phone and will sync after you sign in again.`
            : 'You will need to sign in again to use the app.'
        }
        confirmTitle="Sign out"
        destructive
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          logout();
        }}
        testID="logout-confirm"
      />
    </Screen>
  );
}
