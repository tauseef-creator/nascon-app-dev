// Screen frame: safe area, pinned SyncBar, tenant-branded header, optional scroll + pull to refresh.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBrand } from '../auth/AuthContext';
import { colors, onColor, spacing, TOUCH } from '../theme';
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
    <View
      accessible
      accessibilityLabel={`${brand.tenantName} logo`}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: brand.primary,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: onColor(brand.primary), fontWeight: '800', fontSize: size * 0.38 }}>{initials || 'N'}</Text>
    </View>
  );
}

export function Header({ title, subtitle, back, right }: { title: string; subtitle?: string; back?: boolean; right?: React.ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        {back ? (
          <Pressable
            testID="header-back"
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="chevron-back" size={22} color={colors.white} />
          </Pressable>
        ) : (
          <TenantLogo size={30} />
        )}
        <View style={{ flex: 1 }} />
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
      <Text accessibilityRole="header" numberOfLines={1} style={[styles.title, back && styles.titleSmall]}>
        {title}
      </Text>
      {subtitle ? (
        <Text numberOfLines={1} style={styles.subtitle}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export function Screen({ title, subtitle, back, right, children, scroll = true, refreshing, onRefresh, testID, footer }: Props) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']} testID={testID}>
      <LinearGradient
        pointerEvents="none"
        colors={[colors.headerTint, colors.bg]}
        style={styles.wash}
      />
      <SyncBar />
      <Header title={title} subtitle={subtitle} back={back} right={right} />
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
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.sm },
  headerTop: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center' },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -spacing.xs,
  },
  title: { fontSize: 34, fontWeight: '800', color: colors.white, letterSpacing: -0.6 },
  titleSmall: { fontSize: 28 },
  subtitle: { fontSize: 15, fontWeight: '600', color: colors.textMuted, marginTop: 2 },
  right: { flexDirection: 'row', alignItems: 'center' },
  body: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl },
});
