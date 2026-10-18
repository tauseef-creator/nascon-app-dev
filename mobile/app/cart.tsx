import { Icon } from '../src/components/Icon';
import { ProductArt } from '../src/components/ProductArt';
import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../src/api/client';
import { AppError, errorText } from '../src/api/errors';
import { Order, Product } from '../src/api/types';
import { useAuth, useBrand } from '../src/auth/AuthContext';
import { ConfirmDialog } from '../src/components/ConfirmDialog';
import { Screen } from '../src/components/Screen';
import { Stepper } from '../src/components/Stepper';
import { useToast } from '../src/components/Toast';
import { Card, EmptyState, ErrorBanner, Field, InfoBanner, money, PrimaryButton, Row, SecondaryButton, SectionTitle } from '../src/components/ui';
import { useCachedQuery } from '../src/hooks/useCachedQuery';
import { writeCache } from '../src/offline/cache';
import { useSync } from '../src/offline/SyncProvider';
import { CartItem, useCart } from '../src/store/CartContext';
import { colors, radius, spacing, text } from '../src/theme';

const CARDS = [
  { token: 'tok_success', title: 'Test card: approved', detail: 'Visa ending 4242. Payment goes through.', icon: 'card' as const },
  { token: 'tok_declined', title: 'Test card: declined', detail: 'The bank declines this card.', icon: 'card-outline' as const },
  { token: 'tok_capture_fail', title: 'Test card: capture fails', detail: 'Approved, then fails to complete.', icon: 'card-outline' as const },
];

export default function CartScreen() {
  const { user } = useAuth();
  const brand = useBrand();
  const cart = useCart();
  const sync = useSync();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [token, setToken] = useState('tok_success');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const card = CARDS.find((c) => c.token === token)!;
  // Product photos come from the cached catalogue (same query as the store), so they also show offline.
  const catalogue = useCachedQuery<{ products: Product[] }>('products', '/api/v1/products');
  const images = useMemo(() => new Map((catalogue.data?.products ?? []).map((p) => [p.product_id, p.image_url ?? null])), [catalogue.data]);

  const removeLine = (item: CartItem) => {
    cart.remove(item.variant_id);
    toast(`${item.name} removed from your cart.`, 'info', {
      label: 'Undo',
      accessibilityLabel: `Undo removing ${item.name}`,
      onPress: () => cart.add(item),
    });
  };

  const pay = async () => {
    setConfirm(false);
    setBusy(true);
    setError(null);
    const lines = cart.items.map((i) => ({ ...i }));
    try {
      const order = await api<Order>('/audit/v1/checkout', {
        method: 'POST',
        body: {
          order_id: randomUUID(),
          customer_id: user?.user_id,
          items: lines.map((i) => ({ variant_id: i.variant_id, quantity: i.quantity })),
          discount_code: appliedCode,
          payment: { token },
        },
        timeoutMs: 20000,
      });
      const full = { ...order, lines, discount_code: appliedCode };
      const saved = await Promise.allSettled([
        writeCache(`order:${order.order_id}`, full),
        writeCache('order:last', { order_id: order.order_id }),
      ]);
      cart.setLastOrder(full);
      cart.clear();
      router.replace(`/receipt/${order.order_id}`);
      if (saved.some((result) => result.status === 'rejected')) {
        toast('Payment succeeded, but the receipt could not be saved on this phone.', 'info');
      }
    } catch (e) {
      const err = e instanceof AppError ? e : new AppError('UNKNOWN');
      if (err.isNetwork) setError("We couldn't reach the server, so nothing was charged. Check your connection and try again.");
      else if (err.code === 'INVALID_DISCOUNT_CODE') {
        setError(errorText(err) + ' Remove it or try another code.');
      } else setError(errorText(err));
      toast(err.isNetwork ? 'Payment not sent. You were not charged.' : errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!cart.items.length) {
    return (
      <Screen title="Your cart" back testID="cart-screen">
        <EmptyState
          icon="cart-outline"
          title="Your cart is empty"
          message="Browse the store and add an item to get started."
          actionTitle="Go to the store"
          onAction={() => router.replace('/store')}
          testID="cart-empty"
        />
      </Screen>
    );
  }

  return (
    <Screen title="Your cart" subtitle={`${cart.count} item${cart.count === 1 ? '' : 's'}`} back testID="cart-screen">
      {cart.items.map((i) => (
        <Card key={i.variant_id} testID={`cart-item-${i.variant_id}`} style={styles.item}>
          <View style={styles.thumb} accessible={false}>
            <ProductArt product={{ product_id: i.product_id, image_url: images.get(i.product_id) ?? null }} height={72} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={text.label} numberOfLines={2}>{i.name}</Text>
            {i.size || i.color ? (
              <Text style={[text.small, { marginTop: 2 }]} numberOfLines={1}>
                {[i.size && `Size ${i.size}`, i.color].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
            <Text style={text.small}>{money(i.price_minor, i.currency)} each</Text>
            <View style={styles.itemFoot}>
              <Text style={[text.label, { fontSize: 17 }]}>{money(i.price_minor * i.quantity, i.currency)}</Text>
              <Stepper
                compact
                value={i.quantity}
                max={Math.max(1, i.stock)}
                onChange={(v) => cart.setQuantity(i.variant_id, v)}
                onRemove={() => removeLine(i)}
                removeTestID={`cart-remove-${i.variant_id}`}
                removeLabel={`Remove ${i.name} from cart`}
                testID={`cart-qty-${i.variant_id}`}
                label={`Quantity of ${i.name}`}
              />
            </View>
          </View>
        </Card>
      ))}

      <SectionTitle>Discount code</SectionTitle>
      <Card>
        {appliedCode ? (
          <View style={{ gap: spacing.sm }}>
            <InfoBanner tone="success" icon="pricetag" message={`Code ${appliedCode} added. The discount is checked and applied when you pay.`} testID="cart-code-applied" />
            <SecondaryButton title="Remove code" compact onPress={() => setAppliedCode(null)} testID="cart-code-remove" />
          </View>
        ) : (
          <>
            <Field label="Code (optional)" testID="cart-code" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} placeholder="For example WELCOME10" />
            <SecondaryButton
              title="Apply code"
              compact
              disabled={!code.trim()}
              onPress={() => {
                setAppliedCode(code.trim().toUpperCase());
                setError(null);
              }}
              testID="cart-code-apply"
            />
          </>
        )}
      </Card>

      <SectionTitle>Payment method</SectionTitle>
      <View accessibilityRole="radiogroup" accessibilityLabel="Payment method">
        {CARDS.map((c) => {
          const sel = c.token === token;
          return (
            <Pressable
              key={c.token}
              testID={`pay-${c.token}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: sel, checked: sel }}
              accessibilityLabel={`${c.title}. ${c.detail}`}
              onPress={() => setToken(c.token)}
              style={[styles.payOpt, sel && { borderColor: colors.accent, backgroundColor: colors.accentBg }]}
            >
              <Icon name={sel ? 'radio-button-on' : 'radio-button-off'} size={24} color={sel ? colors.accent : colors.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={text.label}>{c.title}</Text>
                <Text style={text.small}>{c.detail}</Text>
              </View>
              <Icon name={c.icon} size={24} color={colors.textMuted} />
            </Pressable>
          );
        })}
      </View>
      <Text style={[text.small, { marginBottom: spacing.md }]}>This is a mock payment gateway for the demo. No real money is charged.</Text>

      <Card testID="cart-summary">
        <Row label="Subtotal" value={money(cart.subtotal)} />
        <Row label="Discount" value={appliedCode ? 'Applied at payment' : 'None'} />
        <View style={{ height: 1, backgroundColor: colors.divider, marginVertical: spacing.sm }} />
        <Row label="Estimated total" value={<Text style={{ fontSize: 22, fontFamily: 'Inter_800ExtraBold', color: colors.text }}>{money(cart.subtotal)}</Text>} />
      </Card>

      {!sync.online ? <InfoBanner tone="warning" icon="cloud-offline-outline" message="You're offline. Payment needs a connection, so your cart is kept until you're back online." /> : null}
      {error ? <ErrorBanner message={error} testID="cart-error" /> : null}
      <PrimaryButton
        title={`Pay ${money(cart.subtotal)}`}
        onPress={() => setConfirm(true)}
        loading={busy}
        disabled={!sync.online}
        testID="cart-pay"
      />

      <ConfirmDialog
        visible={confirm}
        title="Confirm payment"
        message={`Pay ${money(cart.subtotal)}${appliedCode ? ` before discount code ${appliedCode}` : ''} with "${card.title}" for ${cart.count} item${cart.count === 1 ? '' : 's'}?`}
        confirmTitle="Pay now"
        onCancel={() => setConfirm(false)}
        onConfirm={pay}
        testID="pay-confirm"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  thumb: { width: 72, height: 72, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.cardHi },
  itemFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' },
  payOpt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.cardHi,
    marginBottom: spacing.sm,
  },
});
