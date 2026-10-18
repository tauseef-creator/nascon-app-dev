import { Icon } from '../../src/components/Icon';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { canManageRoster, ROLE_LABEL, useAuth, useBrand } from '../../src/auth/AuthContext';
import { ConfirmDialog } from '../../src/components/ConfirmDialog';
import { Screen } from '../../src/components/Screen';
import { SectionTitle } from '../../src/components/ui';
import { useSync } from '../../src/offline/SyncProvider';
import { useCart } from '../../src/store/CartContext';
import { colors, radius, spacing, text } from '../../src/theme';

type IconName = React.ComponentProps<typeof Icon>['name'];

const CAN_BROADCAST = new Set(['player', 'league_organizer', 'super_admin', 'club_manager']);
// Seeded co-stream session (spec 5.5 / 6.3).
const DEMO_SESSION = 'cs-session-101';

function initialsOf(name: string, email: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length ? words.slice(0, 2).map((w) => w[0]!) : [email[0] ?? '?'];
  return letters.join('').toUpperCase();
}

function LinkRow({ icon, title, detail, onPress, testID, last, danger }: { icon: IconName; title: string; detail?: string; onPress: () => void; testID: string; last?: boolean; danger?: boolean }) {
  const tint = danger ? colors.danger : colors.text;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${title}. ${detail}` : title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.cardHi }]}
    >
      <View style={styles.rowIcon}>
        <Icon name={icon} size={20} color={tint} />
      </View>
      <View style={[styles.rowBody, !last && styles.rowDivider]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: tint }]}>{title}</Text>
          {detail ? <Text style={styles.rowDetail} numberOfLines={1}>{detail}</Text> : null}
        </View>
        {danger ? null : <Icon name="chevron-forward" size={16} color={colors.textMuted} />}
      </View>
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
  const role = ROLE_LABEL[user.role] ?? user.role;
  const tenantName = tenant?.name ?? brand.tenantName;

  return (
    <Screen title="Profile" testID="more-screen" hideRole>
      <View testID="profile-card" style={styles.card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
          <View style={styles.avatar} accessible accessibilityLabel={`Profile picture for ${user.display_name}`}>
            <Text style={styles.avatarText}>{initialsOf(user.display_name, user.email)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={2}>{user.display_name}</Text>
            <Text style={[text.small, { marginTop: 2 }]} numberOfLines={1}>{user.email}</Text>
          </View>
        </View>
        <View style={styles.cardFoot}>
          <View testID="profile-role" style={styles.roleChip} accessible accessibilityLabel={`Role: ${role}`}>
            <Icon name="shield-checkmark" size={14} color={colors.accent} />
            <Text style={styles.roleText}>{role}</Text>
          </View>
          <Text style={[text.small, { flex: 1, textAlign: 'right' }]} numberOfLines={1} accessibilityLabel={`Organisation: ${tenantName}`}>{tenantName}</Text>
        </View>
      </View>

      <SectionTitle>Live</SectionTitle>
      <View style={styles.group}>
      {CAN_BROADCAST.has(user.role) ? (
        <LinkRow icon="videocam-outline" title="Go live" detail="Stream key and ingest URLs for OBS or FFmpeg" onPress={() => router.push('/broadcast')} testID="more-broadcast" />
      ) : null}
      <LinkRow icon="grid-outline" title="Co-stream" detail={`Watch and chat in ${DEMO_SESSION}`} onPress={() => router.push(`/stream/${DEMO_SESSION}`)} testID="more-costream" last />
      </View>

      <SectionTitle>App</SectionTitle>
      <View style={styles.group}>
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
      <LinkRow icon="qr-code-outline" title="Scan a QR code" detail="Open a match, club, athlete or stream" onPress={() => router.push('/scan')} testID="more-scan" />
      <LinkRow icon="settings-outline" title="Settings" detail="Server address and device details" onPress={() => router.push('/settings')} testID="more-settings" last />
      </View>

      <SectionTitle>Account</SectionTitle>
      <View style={styles.group}>
      <LinkRow icon="log-out-outline" title="Sign out" onPress={() => setConfirm(true)} testID="more-logout" last danger />
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

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(28,28,30,0.86)',
    borderRadius: 24,
    padding: spacing.xl,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.accentBg,
    borderWidth: 1,
    borderColor: 'rgba(48,209,88,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.accent, fontSize: 22, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },
  name: { color: colors.text, fontSize: 22, lineHeight: 28, fontFamily: 'Inter_800ExtraBold', letterSpacing: -0.6 },
  cardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  roleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.accentBg,
  },
  roleText: { color: colors.accent, fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  group: { backgroundColor: 'rgba(28,28,30,0.86)', borderRadius: 20, overflow: 'hidden', marginBottom: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)' },
  row: { minHeight: 60, flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.lg, gap: spacing.md },
  rowIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cardHi, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.1)' },
  rowBody: { flex: 1, minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingRight: spacing.lg, paddingVertical: spacing.sm },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', letterSpacing: -0.1 },
  rowDetail: { color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 2 },
});
