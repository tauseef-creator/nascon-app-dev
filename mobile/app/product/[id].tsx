import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Product } from '../../src/api/types';
import { Screen } from '../../src/components/Screen';
import { Stepper } from '../../src/components/Stepper';
import { available, StockText } from '../../src/components/StockText';
import { useToast } from '../../src/components/Toast';
import { CachedNotice, Card, Chip, EmptyState, ErrorBanner, IconButton, LoadingView, money, PrimaryButton, SecondaryButton } from '../../src/components/ui';
import { useCachedQuery } from '../../src/hooks/useCachedQuery';
import { humanize } from '../../src/hooks/useClubNames';
import { useCart } from '../../src/store/CartContext';
import { colors, radius, spacing, text } from '../../src/theme';
import { ProductArt } from '../../src/components/ProductArt';

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const cart = useCart();
  const toast = useToast();
  const q = useCachedQuery<{ products: Product[] }>('products', '/api/v1/products');
  const product = useMemo(() => q.data?.products.find((p) => p.product_id === id) ?? null, [q.data, id]);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);

  useEffect(() => {
    if (product && !variantId) {
      const firstAvail = product.variants.find((v) => available(v) > 0) ?? product.variants[0];
      setVariantId(firstAvail?.variant_id ?? null);
    }
  }, [product, variantId]);

  const variant = product?.variants.find((v) => v.variant_id === variantId) ?? null;
  const inCart = cart.items.find((i) => i.variant_id === variantId)?.quantity ?? 0;
  const avail = variant ? Math.max(0, available(variant) - inCart) : 0;

  useEffect(() => {
    setQty((q0) => Math.max(1, Math.min(q0, Math.max(avail, 1))));
  }, [avail]);

  const add = (go: boolean) => {
    if (!product || !variant) return;
    cart.add({
      variant_id: variant.variant_id,
      product_id: product.product_id,
      name: product.name,
      size: variant.size,
      color: variant.color,
      price_minor: variant.price_minor,
      currency: variant.currency,
      quantity: qty,
      stock: available(variant),
    });
    if (go) router.push('/cart');
    else toast(`Added ${qty} × ${product.name}${variant.size ? ` (${variant.size})` : ''} to your cart.`);
  };

  const cartBtn = <IconButton icon="cart-outline" label="Open cart" badge={cart.count} color={colors.text} onPress={() => router.push('/cart')} testID="product-cart" />;

  if (q.loading && !q.data) {
    return (
      <Screen title="Product" back right={cartBtn}>
        <LoadingView label="Loading product…" />
      </Screen>
    );
  }
  if (!product) {
    return (
      <Screen title="Product" back right={cartBtn}>
        {q.error ? (
          <ErrorBanner message={q.error} onRetry={q.refresh} />
        ) : (
          <EmptyState icon="pricetag-outline" title="This product is no longer available" actionTitle="Back to store" onAction={() => router.replace('/store')} />
        )}
      </Screen>
    );
  }

  return (
    <Screen title={product.name} back right={cartBtn} onRefresh={q.refresh} refreshing={q.refreshing} testID="product-screen">
      {q.fromCache && q.updatedAt ? <CachedNotice updatedAt={q.updatedAt} /> : null}
      <View style={{ height: 340, borderRadius: 26, overflow: 'hidden', marginBottom: spacing.md, backgroundColor: colors.card }} accessible accessibilityLabel={`${humanize(product.category)} picture of ${product.name}`}>
        <ProductArt product={product} height={340} />
        <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.92)']} locations={[0.3, 0.65, 1]} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, justifyContent: 'flex-end', padding: spacing.lg }}>
          <Text style={{ color: colors.accent, fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1 }}>{humanize(product.category).toUpperCase()}</Text>
          <Text style={[text.h1, { color: colors.white, marginTop: spacing.xs }]} accessibilityRole="header" numberOfLines={2}>{product.name}</Text>
          <Text style={{ fontSize: 26, fontFamily: 'Inter_800ExtraBold', marginTop: spacing.sm, color: colors.white }} testID="product-price">{variant ? money(variant.price_minor, variant.currency) : ''}</Text>
        </LinearGradient>
      </View>
      <Card style={{ borderRadius: radius.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}><Ionicons name="checkmark-circle" size={18} color={colors.accent} /><Text style={[text.label, { flex: 1, fontSize: 13 }]}>Official club merchandise</Text>{variant ? <StockText count={available(variant)} /> : null}</View>
        {product.description ? <Text style={[text.muted, { marginTop: spacing.md }]}>{product.description}</Text> : null}
      </Card>

      <Card style={{ borderRadius: radius.lg }}>
      <Text style={[text.title, { marginBottom: spacing.md }]}>Choose an option</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }} accessibilityRole="radiogroup" accessibilityLabel="Size">
        {product.variants.map((v) => {
          const a = available(v);
          const lbl = [v.size, v.color].filter(Boolean).join(' · ') || 'Standard';
          return (
            <Chip
              key={v.variant_id}
              testID={`variant-${v.variant_id}`}
              label={a > 0 ? lbl : `${lbl} (sold out)`}
              accessibilityLabel={`${lbl}, ${a > 0 ? `${a} available` : 'sold out'}`}
              selected={variantId === v.variant_id}
              disabled={a <= 0}
              onPress={() => setVariantId(v.variant_id)}
            />
          );
        })}
      </View>
      <View style={{ height: 1, backgroundColor: colors.divider, marginVertical: spacing.lg }} />
      <Text style={[text.title, { marginBottom: spacing.md }]}>Quantity</Text>
      <Stepper value={qty} max={Math.max(1, avail)} onChange={setQty} testID="product-qty" label="Quantity" />
      {inCart ? <Text style={[text.small, { marginTop: spacing.sm }]}>You already have {inCart} of this size in your cart.</Text> : null}
      </Card>

      <View style={{ gap: spacing.sm, marginTop: spacing.xl }}>
        <PrimaryButton
          title={avail > 0 ? `Buy now · ${variant ? money(variant.price_minor * qty, variant.currency) : ''}` : 'Sold out'}
          disabled={!variant || avail <= 0}
          onPress={() => add(true)}
          testID="product-buy-now"
        />
        <SecondaryButton title="Add to cart" icon="cart-outline" disabled={!variant || avail <= 0} onPress={() => add(false)} testID="product-add" />
      </View>
    </Screen>
  );
}
