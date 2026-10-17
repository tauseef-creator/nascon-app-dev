import { router } from 'expo-router';
import React, { useState } from 'react';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Product } from '../../src/api/types';
import { useBrand } from '../../src/auth/AuthContext';
import { ProductArt } from '../../src/components/ProductArt';
import { Screen } from '../../src/components/Screen';
import { available, StockText } from '../../src/components/StockText';
import { CachedNotice, EmptyState, ErrorBanner, IconButton, LoadingView, money, PressableCard, PrimaryButton } from '../../src/components/ui';
import { useCachedQuery } from '../../src/hooks/useCachedQuery';
import { humanize } from '../../src/hooks/useClubNames';
import { useCart } from '../../src/store/CartContext';
import { colors, radius, spacing, text } from '../../src/theme';

export default function StoreTab() {
  const brand = useBrand();
  const cart = useCart();
  const q = useCachedQuery<{ products: Product[] }>('products', '/api/v1/products');
  const products = q.data?.products ?? [];
  const [category, setCategory] = useState('all');
  const categories = ['all', ...Array.from(new Set(products.map((p) => p.category)))];
  const visible = category === 'all' ? products : products.filter((p) => p.category === category);

  return (
    <Screen
      title="Store"
      subtitle={`${brand.tenantName} official merchandise`}
      onRefresh={q.refresh}
      refreshing={q.refreshing}
      testID="store-screen"
      right={<IconButton icon="cart-outline" label="Open cart" badge={cart.count} color={colors.text} onPress={() => router.push('/cart')} testID="store-cart" />}
      footer={
        cart.count ? (
          <View style={{ padding: spacing.md, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.divider }}>
            <PrimaryButton
              title={`View cart (${cart.count}) · ${money(cart.subtotal)}`}
              icon="cart"
              onPress={() => router.push('/cart')}
              testID="store-view-cart"
            />
          </View>
        ) : null
      }
    >
      <View style={{ height: 150, borderRadius: 24, overflow: 'hidden', marginBottom: spacing.md, backgroundColor: colors.card }} accessible accessibilityLabel="Matchday collection banner">
        <Image source={require('../../assets/merch.jpg')} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} contentFit="cover" />
        <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.85)']} style={{ flex: 1, justifyContent: 'flex-end', padding: spacing.lg }}>
          <Text style={{ color: colors.accent, fontSize: 12, fontFamily: 'Inter_700Bold', letterSpacing: 0.8 }}>MATCHDAY COLLECTION</Text>
          <Text style={{ color: colors.white, fontSize: 20, fontFamily: 'Inter_700Bold', marginTop: 2 }}>Wear your club colours</Text>
        </LinearGradient>
      </View>
      {q.fromCache && q.updatedAt ? <CachedNotice updatedAt={q.updatedAt} /> : null}
      {q.loading && !q.data ? <LoadingView label="Loading products…" /> : null}
      {q.error && !q.data ? <ErrorBanner message={q.error} onRetry={q.refresh} testID="store-error" /> : null}
      {q.data && !products.length ? (
        <EmptyState icon="bag-handle-outline" title="No products yet" message="Club merchandise will appear here when it is added." testID="store-empty" />
      ) : null}
      {products.length ? <>
        <Text style={[text.title, { marginVertical: spacing.md }]}>Shop the collection <Text style={{ color: colors.textMuted }}>({products.length})</Text></Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.lg }}>
          {categories.map((c) => <Pressable key={c} testID={`store-filter-${c}`} accessibilityRole="button" accessibilityState={{ selected: c === category }} onPress={() => setCategory(c)} style={{ backgroundColor: c === category ? colors.white : colors.card, borderRadius: 20, minHeight: 36, paddingHorizontal: spacing.lg, justifyContent: 'center' }}><Text style={{ color: c === category ? colors.black : colors.text, fontSize: 12, fontFamily: 'Inter_700Bold' }}>{c === 'all' ? 'All' : humanize(c)}</Text></Pressable>)}
        </ScrollView>
      </> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
      {visible.map((p) => {
        const prices = p.variants.map((v) => v.price_minor);
        const min = prices.length ? Math.min(...prices) : 0;
        const stock = p.variants.reduce((n, v) => n + available(v), 0);
        const cur = p.variants[0]?.currency ?? 'PKR';
        return (
          <PressableCard
            key={p.product_id}
            testID={`product-card-${p.product_id}`}
            label={`${p.name}, from ${money(min, cur)}. ${stock > 0 ? 'In stock' : 'Sold out'}. Opens product.`}
            onPress={() => router.push(`/product/${p.product_id}`)}
            style={{ width: '48.5%', padding: 0, overflow: 'hidden', borderRadius: radius.lg }}
          >
            <View style={{ height: 258 }}>
              <ProductArt product={p} height={258} />
              <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.94)']} locations={[0.32, 0.62, 1]} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'flex-end', padding: spacing.md }}>
                <Text style={{ color: colors.accent, fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.6 }}>{humanize(p.category).toUpperCase()}</Text>
                <Text style={[text.label, { fontSize: 13, marginTop: 4 }]} numberOfLines={2}>{p.name}</Text>
                <Text style={[text.label, { fontSize: 14, marginTop: spacing.xs }]} numberOfLines={1}>{prices.length > 1 && Math.max(...prices) !== min ? 'From ' : ''}{money(min, cur)}</Text>
                <View style={{ marginTop: 4 }}><StockText count={stock} /></View>
              </LinearGradient>
            </View>
          </PressableCard>
        );
      })}
      </View>
    </Screen>
  );
}
