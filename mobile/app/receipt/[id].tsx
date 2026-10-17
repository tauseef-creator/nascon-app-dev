import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Order } from '../../src/api/types';
import { Screen } from '../../src/components/Screen';
import { useToast } from '../../src/components/Toast';
import { Card, EmptyState, ErrorBanner, LoadingView, money, PrimaryButton, Row, SecondaryButton, SectionTitle } from '../../src/components/ui';
import { readCache } from '../../src/offline/cache';
import { CartItem, useCart } from '../../src/store/CartContext';
import { colors, spacing, text } from '../../src/theme';

type FullOrder = Order & { lines: CartItem[]; discount_code: string | null };

export default function Receipt() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const cart = useCart();
  const toast = useToast();
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

  return (
    <Screen title="Receipt" back testID="receipt-screen">
      <Card testID="receipt-success">
        <View style={{ alignItems: 'center', gap: spacing.sm }} accessible accessibilityLabel={`Payment successful. Total paid ${money(order.total_minor, order.currency)}`}>
          <Ionicons name="checkmark-circle" size={64} color={colors.success} />
          <Text style={text.h1}>Payment successful</Text>
          <Text style={[text.muted, { textAlign: 'center' }]}>Thank you for your order. Your receipt is below.</Text>
          <Text style={{ fontSize: 32, fontFamily: 'Inter_800ExtraBold', color: colors.text }} testID="receipt-total">
            {money(order.total_minor, order.currency)}
          </Text>
        </View>
      </Card>
      <SectionTitle>Items</SectionTitle>
      <Card testID="receipt-items">
        {order.items.map((i) => (
          <Row key={i.variant_id} label={`${i.quantity} × ${nameFor(i.variant_id)}`} value={money(i.unit_price_minor * i.quantity, order.currency)} />
        ))}
        <View style={{ height: 1, backgroundColor: colors.divider, marginVertical: spacing.sm }} />
        <Row label="Subtotal" value={money(order.subtotal_minor, order.currency)} />
        <Row label={order.discount_code ? `Discount (${order.discount_code})` : 'Discount'} value={order.discount_minor ? `− ${money(order.discount_minor, order.currency)}` : 'None'} />
        <Row label="Total paid" value={<Text style={{ fontSize: 20, fontFamily: 'Inter_800ExtraBold', color: colors.text }}>{money(order.total_minor, order.currency)}</Text>} />
      </Card>
      <SectionTitle>Order details</SectionTitle>
      <Card>
        <Row label="Order number" value={<Text selectable style={[text.small, { textAlign: 'right' }]}>{order.order_id}</Text>} />
        <Row label="Payment" value={order.payment?.state === 'captured' ? 'Paid' : order.status} />
      </Card>
      {error ? <ErrorBanner message={error} /> : null}
      <View style={{ gap: spacing.sm }}>
        <PrimaryButton title="Open receipt PDF" icon="document-text-outline" onPress={openPdf} loading={opening} disabled={!order.receipt?.pdf_base64} testID="receipt-open-pdf" />
        <SecondaryButton title="Continue shopping" icon="bag-handle-outline" onPress={() => router.replace('/store')} testID="receipt-continue" />
      </View>
    </Screen>
  );
}
