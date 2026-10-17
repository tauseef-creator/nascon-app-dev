import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Text, View } from 'react-native';
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
      {products.map((p) => {
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
          >
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <View
                style={{ width: 72, height: 72, borderRadius: radius.md, overflow: 'hidden' }}
                accessible={false}
              >
                <ProductArt product={p} height={72} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={text.label} numberOfLines={2}>
                  {p.name}
                </Text>
                <Text style={text.small}>{humanize(p.category)}</Text>
                <Text style={[text.label, { fontSize: 18, marginTop: 4 }]}>
                  {prices.length > 1 && Math.max(...prices) !== min ? 'From ' : ''}
                  {money(min, cur)}
                </Text>
                <StockText count={stock} />
              </View>
              <Ionicons name="chevron-forward" size={22} color={colors.textMuted} style={{ alignSelf: 'center' }} />
            </View>
          </PressableCard>
        );
      })}
    </Screen>
  );
}
