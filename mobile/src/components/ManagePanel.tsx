// Groups every management action for an object ("Manage match", "Manage club") in one
// clearly labelled, accent-outlined card. Render it only for roles that may act.
import { Icon } from './Icon';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Role } from '../api/types';
import { colors, radius, spacing, text } from '../theme';

type IconName = React.ComponentProps<typeof Icon>['name'];

const CAPTION: Partial<Record<Role, string>> = {
  league_organizer: 'Organizer tools',
  super_admin: 'Admin tools',
  club_manager: 'Club manager tools',
};

/** "Organizer tools", "Club manager tools" or "Admin tools" for the signed-in role. */
export const toolsCaption = (role?: Role | null) => (role ? CAPTION[role] ?? 'Management tools' : 'Management tools');

export function ManagePanel({
  title,
  caption,
  icon = 'shield-checkmark',
  description,
  children,
  testID,
  style,
}: {
  title: string;
  caption: string;
  icon?: IconName;
  description?: string;
  children: React.ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View testID={testID} style={[styles.panel, style]}>
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(48,209,88,0.13)', 'rgba(48,209,88,0)']}
        style={styles.wash}
      />
      <View style={styles.head}>
        <View style={styles.iconWrap}>
          <Icon name={icon} size={18} color={colors.accent} accessibilityLabel="Restricted tools" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.caption}>{caption.toUpperCase()}</Text>
          <Text style={text.title} accessibilityRole="header">
            {title}
          </Text>
        </View>
        <View style={styles.lock} accessible accessibilityLabel={`Restricted: ${caption}. Other users cannot see these controls.`}>
          <Icon name="lock-closed" size={12} color={colors.textMuted} />
          <Text style={styles.lockText}>Restricted</Text>
        </View>
      </View>
      {description ? <Text style={[text.small, { marginBottom: spacing.md }]}>{description}</Text> : null}
      {children}
    </View>
  );
}

/** A labelled group inside a ManagePanel, separated by a hairline. */
export function ManageSection({ title, children, first, testID }: { title: string; children: React.ReactNode; first?: boolean; testID?: string }) {
  return (
    <View testID={testID} style={[!first && styles.section]}>
      <Text style={[text.label, { marginBottom: spacing.sm }]} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: 'rgba(24,26,25,0.94)',
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.accent,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  wash: { position: 'absolute', top: 0, left: 0, right: 0, height: 96, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  iconWrap: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.accentBg, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(48,209,88,0.4)', alignItems: 'center', justifyContent: 'center' },
  caption: { color: colors.accent, fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 0.8 },
  lock: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.cardHi, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' },
  lockText: { color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  section: { marginTop: spacing.lg, paddingTop: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
