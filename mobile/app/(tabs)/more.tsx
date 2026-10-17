import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { canManageRoster, ROLE_LABEL, useAuth, useBrand } from '../../src/auth/AuthContext';
import { ConfirmDialog } from '../../src/components/ConfirmDialog';
import { Screen, TenantLogo } from '../../src/components/Screen';
import { SectionTitle } from '../../src/components/ui';
import { useSync } from '../../src/offline/SyncProvider';
import { useCart } from '../../src/store/CartContext';
import { colors, spacing, text } from '../../src/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function LinkRow({ icon, title, detail, onPress, testID }: { icon: IconName; title: string; detail?: string; onPress: () => void; testID: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={detail ? `${title}. ${detail}` : title} onPress={onPress} style={{ minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
        <View style={{ width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cardHi }}><Ionicons name={icon} size={19} color={colors.accent} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[text.label, { fontSize: 14 }]}>{title}</Text>
          {detail ? <Text style={[text.small, { fontSize: 11 }]}>{detail}</Text> : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
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
    <Screen title="Profile" testID="more-screen">
      <View testID="profile-card" style={{ borderRadius: 24, overflow: 'hidden', marginBottom: spacing.md }}>
        <LinearGradient colors={['#20592C', '#142B1B', colors.card]} style={{ minHeight: 216, padding: spacing.xl, justifyContent: 'space-between' }}>
          <Text style={{ color: '#B8E8C2', fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1 }}>YOUR ACCOUNT</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.28)' }}><TenantLogo size={48} /></View>
            <View style={{ flex: 1 }}><Text style={[text.h1, { fontSize: 22 }]} numberOfLines={2}>{user.display_name}</Text><Text style={[text.small, { color: '#D6E0D7' }]} numberOfLines={1}>{user.email}</Text></View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <View testID="profile-role" style={{ paddingHorizontal: spacing.md, paddingVertical: 6, backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 16 }}><Text style={{ color: colors.white, fontSize: 11, fontFamily: 'Inter_700Bold' }}>{ROLE_LABEL[user.role] ?? user.role}</Text></View>
            <Text style={[text.small, { color: '#D6E0D7', flex: 1 }]} numberOfLines={1}>{tenant?.name ?? brand.tenantName}</Text>
          </View>
        </LinearGradient>
      </View>

      <SectionTitle>App</SectionTitle>
      <View style={{ backgroundColor: colors.card, borderRadius: 22, overflow: 'hidden', marginBottom: spacing.lg }}>
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
      </View>

      <SectionTitle>Account</SectionTitle>
      <View style={{ backgroundColor: colors.card, borderRadius: 22, overflow: 'hidden', marginBottom: spacing.lg }}>
      <LinkRow icon="log-out-outline" title="Sign out" onPress={() => setConfirm(true)} testID="more-logout" />
      </View>

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
