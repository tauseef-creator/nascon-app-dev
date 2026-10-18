// App mark: the NaSCon League "Blade Crest": an angular shield, slanted N, graphite split.
// Pure vector, so it stays sharp at every size. Raster copies live in assets/ (icon, splash, favicon).
import React, { useId } from 'react';
import Svg, { ClipPath, Defs, G, Path, Rect } from 'react-native-svg';

export const BRAND = { ink: '#0D0D10', accent: '#3A3D45', light: '#FFFFFF' };

const SHIELD = 'M256 28 L462 92 L438 300 L256 486 L74 300 L50 92 Z';
const MONOGRAM = 'M150 360 L182 150 H232 L300 268 L318 150 H368 L336 360 H286 L218 242 L200 360 Z';

export function AppMark({ size = 72 }: { size?: number }) {
  const clipId = `crest-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512" accessibilityLabel="NaSCon League logo">
      <Defs>
        <ClipPath id={clipId}>
          <Path d={SHIELD} />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#${clipId})`}>
        <Rect width="512" height="512" fill={BRAND.ink} />
        <Path d="M50 486 L462 74 V512 H50 Z" fill={BRAND.accent} />
      </G>
      <Path d={SHIELD} fill="none" stroke={BRAND.light} strokeWidth={18} strokeLinejoin="miter" />
      <Path d={MONOGRAM} fill={BRAND.light} />
    </Svg>
  );
}
