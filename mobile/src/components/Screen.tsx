// Screen frame: safe area, pinned SyncBar, tenant-branded header, optional scroll + pull to refresh.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBrand } from '../auth/AuthContext';
import { colors, spacing, TOUCH } from '../theme';
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
        backgroundColor: colors.card,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: brand.primaryText,
      }}
    >
      <Text style={{ color: brand.primaryText, fontWeight: '800', fontSize: size * 0.38 }}>{initials || 'N'}</Text>
    </View>
  );
}

export function Header({ title, subtitle, back, right }: { title: string; subtitle?: string; back?: boolean; right?: React.ReactNode }) {
  const brand = useBrand();
  return (
    <View style={[styles.header, { borderBottomColor: brand.primary }]}>
      {back ? (
        <Pressable
          testID="header-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="arrow-back" size={24} color={colors.white} />
        </Pressable>
      ) : (
        <View style={{ paddingHorizontal: spacing.sm }}>
          <TenantLogo size={30} />
        </View>
      )}
      <View style={{ flex: 1, paddingHorizontal: spacing.xs }}>
        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

export function Screen({ title, subtitle, back, right, children, scroll = true, refreshing, onRefresh, testID, footer }: Props) {
  const brand = useBrand();
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']} testID={testID}>
      <SyncBar />
      <Header title={title} subtitle={subtitle} back={back} right={right} />
      <View style={styles.body}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[brand.primary]} /> : undefined
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
  safe: { flex: 1, backgroundColor: '#111827' },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingRight: spacing.xs, backgroundColor: '#111827', borderBottomWidth: 2 },
  headerBtn: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.xs },
  title: { fontSize: 18, fontWeight: '800', color: colors.white },
  subtitle: { fontSize: 12, fontWeight: '600', color: '#B9C5D3' },
  right: { flexDirection: 'row', alignItems: 'center' },
  body: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
});
