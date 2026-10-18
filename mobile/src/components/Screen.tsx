// Screen frame: safe area, slim header (logo/title + compact sync chip), optional scroll + pull to refresh.
import { Icon } from './Icon';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBrand } from '../auth/AuthContext';
import { colors, onColor, spacing, TOUCH } from '../theme';
import { AppMark } from './AppMark';
import { SyncBar } from './SyncBar';

type Props = {
  title: string;
  subtitle?: string;
  back?: boolean;
  right?: React.ReactNode;
  children: React.ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  testID?: string;
  footer?: React.ReactNode;
  /** Deprecated: the header no longer shows the role (kept so existing callers compile). */
  hideRole?: boolean;
  /** Home: show only the logo; the title is announced to screen readers but not drawn. */
  logoOnly?: boolean;
};

export function TenantLogo({ size = 36 }: { size?: number }) {
  const brand = useBrand();
  const initials = brand.tenantName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  if (brand.logoUrl) {
    return (
      <Image
        source={{ uri: brand.logoUrl }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#fff' }}
        accessibilityLabel={`${brand.tenantName} logo`}
        contentFit="contain"
      />
    );
  }
  return (
    <View accessible accessibilityLabel={`${brand.tenantName} logo`}>
      <AppMark size={size} />
    </View>
  );
}

export function Header({ title, subtitle, back, right, logoOnly }: { title: string; subtitle?: string; back?: boolean; right?: React.ReactNode; hideRole?: boolean; logoOnly?: boolean }) {
  if (back) {
    return (
      <View style={styles.subHeader}>
        <Pressable
          testID="header-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
        >
          <Icon name="chevron-back" size={22} color={colors.white} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: spacing.sm }}>
          <Text accessibilityRole="header" numberOfLines={1} style={styles.subTitle}>
            {title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={1} style={styles.subSubtitle}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={styles.subRight}>
          {right}
          <SyncBar compact />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <TenantLogo size={30} />
        {logoOnly ? (
          <Text accessibilityRole="header" style={styles.srOnly}>{title}</Text>
        ) : (
          <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
            {title}
          </Text>
        )}
        <View style={styles.spacer} />
        {right ? <View style={styles.right}>{right}</View> : null}
        <SyncBar />
      </View>
      {subtitle ? (
        <Text numberOfLines={1} style={styles.subtitle}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export function Screen({ title, subtitle, back, right, children, scroll = true, refreshing, onRefresh, testID, footer, logoOnly }: Props) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']} testID={testID}>
      <LinearGradient
        pointerEvents="none"
        colors={[colors.headerTint, colors.bg]}
        style={styles.wash}
      />
      <Header title={title} subtitle={subtitle} back={back} right={right} logoOnly={logoOnly} />
      <View style={styles.body}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[colors.accent]} tintColor={colors.accent} progressBackgroundColor={colors.card} /> : undefined
            }
          >
            {children}
          </ScrollView>
        ) : (
          <View style={{ flex: 1 }}>{children}</View>
        )}
        {footer}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  wash: { position: 'absolute', top: 0, left: 0, right: 0, height: 320 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  headerTop: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  subHeader: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  subTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: colors.white },
  subSubtitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.textMuted, marginTop: 1 },
  subRight: { minWidth: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flexShrink: 1, fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.white, letterSpacing: -0.4 },
  spacer: { flex: 1 },
  srOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
  subtitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.textMuted, marginTop: 2 },
  right: { flexDirection: 'row', alignItems: 'center' },
  body: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl },
});
