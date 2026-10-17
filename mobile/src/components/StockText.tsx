import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Text, View } from 'react-native';
import { colors } from '../theme';

export const available = (v: { stock: number; reserved?: number }) => Math.max(0, v.stock - (v.reserved ?? 0));

export function StockText({ count }: { count: number }) {
  const out = count <= 0;
  const low = count > 0 && count <= 3;
  const label = out ? 'Sold out' : low ? `Only ${count} left` : 'In stock';
  const color = out ? colors.danger : low ? colors.warning : colors.success;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} accessible accessibilityLabel={label}>
      <Ionicons name={out ? 'close-circle' : low ? 'alert-circle' : 'checkmark-circle'} size={18} color={color} />
      <Text style={{ color, fontSize: 15, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}
