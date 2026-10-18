import { Icon } from './Icon';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, TOUCH } from '../theme';

type Props = {
  value: number;
  min?: number;
  max: number;
  onChange: (v: number) => void;
  testID: string;
  label: string;
  /** When set, the minus button turns into a trash button at the minimum quantity. */
  onRemove?: () => void;
  removeTestID?: string;
  removeLabel?: string;
  /** Smaller type and glyphs for list rows (touch targets stay 48dp). */
  compact?: boolean;
};

export function Stepper({ value, min = 1, max, onChange, testID, label, onRemove, removeTestID, removeLabel, compact }: Props) {
  const dec = value > min;
  const inc = value < max;
  const showRemove = !dec && !!onRemove;
  const glyph = compact ? 18 : 24;
  return (
    <View
      style={[styles.wrap, compact && styles.wrapCompact]}
      accessibilityRole="adjustable"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityValue={{ min, max, now: value }}
    >
      {showRemove ? (
        <Pressable
          testID={removeTestID ?? `${testID}-remove`}
          accessibilityRole="button"
          accessibilityLabel={removeLabel ?? `Remove ${label}`}
          onPress={onRemove}
          style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
        >
          <Icon name="trash-outline" size={glyph} color={colors.text} />
        </Pressable>
      ) : (
        <Pressable
          testID={`${testID}-minus`}
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label}`}
          accessibilityState={{ disabled: !dec }}
          disabled={!dec}
          onPress={() => onChange(value - 1)}
          style={({ pressed }) => [styles.btn, !dec && { opacity: 0.35 }, pressed && styles.pressed]}
        >
          <Icon name="remove" size={glyph} color={colors.text} />
        </Pressable>
      )}
      <Text style={[styles.value, compact && styles.valueCompact]} testID={`${testID}-value`}>
        {value}
      </Text>
      <Pressable
        testID={`${testID}-plus`}
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label}`}
        accessibilityState={{ disabled: !inc }}
        disabled={!inc}
        onPress={() => onChange(value + 1)}
        style={({ pressed }) => [styles.btn, !inc && { opacity: 0.35 }, pressed && styles.pressed]}
      >
        <Icon name="add" size={glyph} color={colors.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.pill, alignSelf: 'flex-start', backgroundColor: colors.card },
  wrapCompact: { backgroundColor: colors.cardHi },
  btn: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: 'rgba(255,255,255,0.08)' },
  value: { minWidth: 40, textAlign: 'center', fontSize: 20, fontFamily: 'Inter_800ExtraBold', color: colors.text },
  valueCompact: { minWidth: 24, fontSize: 16, fontFamily: 'Inter_700Bold' },
});
