import { Icon } from '../../src/components/Icon';
import { File, Paths } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useEffect, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';
import { useBrand } from '../../src/auth/AuthContext';
import { ProductArt } from '../../src/components/ProductArt';
import { Order } from '../../src/api/types';
import { Screen } from '../../src/components/Screen';
import { useToast } from '../../src/components/Toast';
import { EmptyState, ErrorBanner, formatDateTime, LoadingView, money, PrimaryButton, SecondaryButton } from '../../src/components/ui';
import { readCache } from '../../src/offline/cache';
import { CartItem, useCart } from '../../src/store/CartContext';
import { colors, spacing } from '../../src/theme';

type FullOrder = Order & { lines: CartItem[]; discount_code: string | null };

export default function Receipt() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const cart = useCart();
  const toast = useToast();
  const brand = useBrand();
  const [order, setOrder] = useState<FullOrder | null>(cart.lastOrder?.order_id === id ? cart.lastOrder : null);
  const [loading, setLoading] = useState(!order);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (order || !id) return;
    readCache<FullOrder>(`order:${id}`)
      .then((c) => setOrder(c?.data ?? null))
      .catch(() => setOrder(null))
      .finally(() => setLoading(false));
  }, [id, order]);

  const openPdf = async () => {
    if (!order?.receipt?.pdf_base64) return;
    setOpening(true);
    setError(null);
    try {
      const file = new File(Paths.document, `receipt-${order.order_id}.pdf`);
      if (file.exists) file.delete();
      file.create();
      await file.write(order.receipt.pdf_base64, { encoding: 'base64' });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Open receipt PDF' });
      } else {
        toast(`Receipt saved to ${file.uri}`, 'info');
      }
    } catch {
      setError("We couldn't open the receipt PDF on this phone. Make sure a PDF viewer or Files app is installed.");
    } finally {
      setOpening(false);
    }
  };

  if (loading) {
    return (
      <Screen title="Receipt" back>
        <LoadingView label="Loading receipt…" />
      </Screen>
    );
  }
  if (!order) {
    return (
      <Screen title="Receipt" back>
        <EmptyState icon="receipt-outline" title="Receipt not found" message="This receipt is not saved on this phone." actionTitle="Go to the store" onAction={() => router.replace('/store')} />
      </Screen>
    );
  }

  const nameFor = (vid: string) => {
    const l = order.lines.find((x) => x.variant_id === vid);
    return l ? `${l.name}${l.size ? ` (${l.size})` : ''}` : vid;
  };

  const when = formatDateTime(new Date().toISOString());
  const tear = (
    <View style={styles.tear}>
      <View style={[styles.notch, { left: -12 }]} />
      <View style={styles.dash} />
      <View style={[styles.notch, { right: -12 }]} />
    </View>
  );
  return (
    <Screen title="Receipt" back testID="receipt-screen">
      <View style={styles.ticket}>
        <LinearGradient colors={['#30D158', '#0B7A34']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.head}>
          <View testID="receipt-success" style={{ alignItems: 'center' }} accessible accessibilityLabel={`Payment successful. Total paid ${money(order.total_minor, order.currency)}`}>
            <View style={styles.tick}>
              <Icon name="checkmark" size={30} color="#0B7A34" />
            </View>
            <Text style={styles.headLabel}>Payment successful</Text>
            <Text style={styles.headTotal} testID="receipt-total">
              {money(order.total_minor, order.currency)}
            </Text>
            <Text style={styles.headMeta}>
              {brand.tenantName} · {when}
            </Text>
          </View>
        </LinearGradient>
        {tear}
        <View style={styles.body} testID="receipt-items">
          <Text style={styles.caption}>ITEMS</Text>
          {order.items.map((i) => {
            const line = order.lines.find((x) => x.variant_id === i.variant_id);
            return (
              <View key={i.variant_id} style={styles.item}>
                <View style={styles.thumb}>
                  <ProductArt product={{ product_id: line?.product_id ?? '' }} height={44} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName} numberOfLines={2}>
                    {nameFor(i.variant_id)}
                  </Text>
                  <Text style={styles.itemQty}>
                    Qty {i.quantity} × {money(i.unit_price_minor, order.currency)}
                  </Text>
                </View>
                <Text style={styles.itemAmt}>{money(i.unit_price_minor * i.quantity, order.currency)}</Text>
              </View>
            );
          })}
          <View style={styles.rule} />
          <Line label="Subtotal" value={money(order.subtotal_minor, order.currency)} />
          <Line
            label={order.discount_code ? `Discount (${order.discount_code})` : 'Discount'}
            value={order.discount_minor ? `− ${money(order.discount_minor, order.currency)}` : '—'}
            accent={!!order.discount_minor}
          />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total paid</Text>
            <Text style={styles.totalValue}>{money(order.total_minor, order.currency)}</Text>
          </View>
        </View>
        {tear}
        <View style={styles.body}>
          <Line label="Status" value={order.payment?.state === 'captured' ? 'Paid' : order.status} accent />
          <Text style={[styles.caption, { marginTop: spacing.md }]}>ORDER NUMBER</Text>
          <Text selectable style={styles.orderId}>
            {order.order_id}
          </Text>
          {order.receipt?.signature ? (
            <View style={styles.signed}>
              <Icon name="shield-checkmark" size={14} color={colors.accent} />
              <Text style={styles.signedText}>Digitally signed receipt</Text>
            </View>
          ) : (
            <View style={{ height: spacing.sm }} />
          )}
        </View>
      </View>
      {error ? <ErrorBanner message={error} /> : null}
      <View style={{ gap: spacing.sm }}>
        <PrimaryButton title="Open receipt PDF" icon="document-text-outline" onPress={openPdf} loading={opening} disabled={!order.receipt?.pdf_base64} testID="receipt-open-pdf" />
        <SecondaryButton title="Continue shopping" icon="bag-handle-outline" onPress={() => router.replace('/store')} testID="receipt-continue" />
      </View>
    </Screen>
  );
}

function Line({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={[styles.lineValue, accent && { color: colors.accent }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  ticket: { backgroundColor: colors.card, borderRadius: 24, overflow: 'hidden', marginBottom: spacing.lg },
  head: { paddingVertical: spacing.xl, paddingHorizontal: spacing.lg },
  tick: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  headLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  headTotal: { color: '#FFFFFF', fontSize: 34, fontFamily: 'Inter_800ExtraBold', marginTop: 2, letterSpacing: -0.5 },
  headMeta: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 4 },
  tear: { height: 24, justifyContent: 'center' },
  dash: { marginHorizontal: spacing.lg, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border },
  notch: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: colors.bg, top: 0 },
  body: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  caption: { color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.8, marginBottom: spacing.sm },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  thumb: { width: 44, height: 44, borderRadius: 10, overflow: 'hidden' },
  itemName: { color: colors.text, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  itemQty: { color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  itemAmt: { color: colors.text, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.sm },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  lineLabel: { color: colors.textMuted, fontSize: 14, fontFamily: 'Inter_400Regular' },
  lineValue: { color: colors.text, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing.sm },
  totalLabel: { color: colors.text, fontSize: 16, fontFamily: 'Inter_700Bold' },
  totalValue: { color: colors.text, fontSize: 20, fontFamily: 'Inter_800ExtraBold' },
  orderId: { color: colors.text, fontSize: 13, fontFamily: 'monospace', letterSpacing: 0.5 },
  signed: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md, marginBottom: spacing.sm },
  signedText: { color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_400Regular' },
});
