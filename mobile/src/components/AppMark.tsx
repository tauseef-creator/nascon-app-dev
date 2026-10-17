// App mark: a pitch centre circle and halfway line on a green gradient tile.
import React from 'react';
import Svg, { Circle, Defs, Line, LinearGradient, Rect, Stop } from 'react-native-svg';

export function AppMark({ size = 72 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessible={false}>
      <Defs>
        <LinearGradient id="markBg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#3BE477" />
          <Stop offset="1" stopColor="#0B7A34" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" rx="24" fill="url(#markBg)" />
      <Rect x="14" y="22" width="72" height="56" rx="6" fill="none" stroke="#FFFFFF" strokeWidth="4" />
      <Line x1="50" y1="22" x2="50" y2="78" stroke="#FFFFFF" strokeWidth="4" />
      <Circle cx="50" cy="50" r="12" fill="none" stroke="#FFFFFF" strokeWidth="4" />
      <Circle cx="50" cy="50" r="3.5" fill="#FFFFFF" />
    </Svg>
  );
}
