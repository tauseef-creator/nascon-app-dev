// Product artwork: a kit drawn in the club's crest colours (no third-party branding).
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { View } from 'react-native';
import Svg, { ClipPath, Defs, G, Path, Rect } from 'react-native-svg';
import { ClubCrest, crestColors } from './ClubCrest';

const SHIRT = 'M30 6 L42 2 C44 8 56 8 58 2 L70 6 L96 20 L86 40 L76 35 L76 98 L24 98 L24 35 L14 40 L4 20 Z';

export function clubFromProduct(name: string): string {
  return name.replace(/\s+(home|away|third|training)?\s*(jersey|kit|shirt|scarf|cap).*$/i, '').trim() || name;
}

export function JerseyArt({ name, height }: { name: string; height: number }) {
  const club = clubFromProduct(name);
  const [a, b] = crestColors(club);
  const w = height * 0.9;
  return (
    <LinearGradient colors={['#2C2C2E', '#141416']} style={{ height, alignItems: 'center', justifyContent: 'center' }}>
      <View>
        <Svg width={w} height={w} viewBox="0 0 100 100" accessible={false}>
          <Defs>
            <ClipPath id="shirt">
              <Path d={SHIRT} />
            </ClipPath>
          </Defs>
          <G clipPath="url(#shirt)">
            <Rect x="0" y="0" width="100" height="100" fill={a} />
            <Rect x="0" y="0" width="24" height="100" fill={b} />
            <Rect x="76" y="0" width="24" height="100" fill={b} />
            <Path d="M42 2 C44 8 56 8 58 2 L54 0 L46 0 Z" fill={b} />
            <Rect x="24" y="0" width="52" height="100" fill="#000" opacity={0.06} />
          </G>
          <Path d={SHIRT} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={1.5} />
        </Svg>
        <View style={{ position: 'absolute', left: w * 0.56, top: w * 0.3 }}>
          <ClubCrest name={club} size={w * 0.14} />
        </View>
      </View>
    </LinearGradient>
  );
}
