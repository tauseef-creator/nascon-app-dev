import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, TOUCH } from '../theme';

export function Stepper({ value, min = 1, max, onChange, testID, label }: { value: number; min?: number; max: number; onChange: (v: number) => void; testID: string; label: string }) {
  const dec = value > min;
  const inc = value < max;
  return (
    <View style={styles.wrap} accessibilityRole="adjustable" accessibilityLabel={`${label}: ${value}`} accessibilityValue={{ min, max, now: value }}>
      <Pressable
        testID={`${testID}-minus`}
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label}`}
        accessibilityState={{ disabled: !dec }}
        disabled={!dec}
        onPress={() => onChange(value - 1)}
        style={[styles.btn, !dec && { opacity: 0.35 }]}
      >
        <Ionicons name="remove" size={24} color={colors.text} />
      </Pressable>
      <Text style={styles.value} testID={`${testID}-value`}>
        {value}
      </Text>
      <Pressable
        testID={`${testID}-plus`}
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label}`}
        accessibilityState={{ disabled: !inc }}
        disabled={!inc}
        onPress={() => onChange(value + 1)}
        style={[styles.btn, !inc && { opacity: 0.35 }]}
      >
        <Ionicons name="add" size={24} color={colors.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.pill, alignSelf: 'flex-start', backgroundColor: colors.card },
  btn: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  value: { minWidth: 40, textAlign: 'center', fontSize: 20, fontWeight: '800', color: colors.text },
});
