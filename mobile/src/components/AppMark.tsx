// App mark: a match ball on a green gradient tile.
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';

export function AppMark({ size = 72 }: { size?: number }) {
  return (
    <LinearGradient
      colors={['#3BE477', '#0B7A34']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ width: size, height: size, borderRadius: size * 0.26, alignItems: 'center', justifyContent: 'center' }}
    >
      <Ionicons name="football" size={size * 0.68} color="#FFFFFF" />
    </LinearGradient>
  );
}
