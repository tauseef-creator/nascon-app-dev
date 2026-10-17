// Demo club crest: a shield drawn from the club name, so every club gets a stable,
// distinct badge without needing logo uploads. Works offline (pure SVG).
import React from 'react';
import Svg, { ClipPath, Defs, G, Path, Rect, Text as SvgText } from 'react-native-svg';

const PALETTES: [string, string][] = [
  ['#C8102E', '#FFFFFF'],
  ['#034694', '#FFFFFF'],
  ['#6CABDD', '#1C2C5B'],
  ['#FDB913', '#231F20'],
  ['#7A263A', '#1BB1E7'],
  ['#00A650', '#FFFFFF'],
  ['#EF0107', '#063672'],
  ['#132257', '#FFFFFF'],
  ['#241F20', '#FFFFFF'],
  ['#F58025', '#1F1F1F'],
  ['#5E2A84', '#F5C400'],
  ['#0057B8', '#FFD700'],
];

const SHIELD = 'M50 4 L92 16 V52 C92 76 74 92 50 100 C26 92 8 76 8 52 V16 Z';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Main crest colour for a club, used to tint match headers. */
export function crestColor(name: string): string {
  return PALETTES[(hash(name || 'club') >>> 4) % PALETTES.length]![0];
}

/** Both crest colours for a club, used for kit artwork. */
export function crestColors(name: string): [string, string] {
  return PALETTES[(hash(name || 'club') >>> 4) % PALETTES.length]!;
}

export function initials(name: string): string {
  const words = name.replace(/\b(FC|SC|CF|AFC|Club)\b/gi, '').split(/\s+/).filter(Boolean);
  const w = words.length ? words : name.split(/\s+/).filter(Boolean);
  return (w.length === 1 ? w[0]!.slice(0, 2) : w.slice(0, 2).map((x) => x[0]).join('')).toUpperCase() || 'FC';
}

export function ClubCrest({ name, size = 40 }: { name: string; size?: number }) {
  const h = hash(name || 'club');
  const [a, b] = PALETTES[(h >>> 4) % PALETTES.length]!;
  const pattern = (h >> 8) % 5;
  const id = `c${h.toString(36)}`;
  const letters = initials(name || 'FC');
  return (
    <Svg width={size} height={size * 1.04} viewBox="0 0 100 104" accessible={false}>
      <Defs>
        <ClipPath id={id}>
          <Path d={SHIELD} />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#${id})`}>
        <Rect x="0" y="0" width="100" height="104" fill={a} />
        {pattern === 0 ? [20, 44, 68].map((x) => <Rect key={x} x={x} y="0" width="12" height="104" fill={b} opacity={0.9} />) : null}
        {pattern === 1 ? <Rect x="50" y="0" width="50" height="104" fill={b} /> : null}
        {pattern === 2 ? <Path d="M0 40 L50 70 L100 40 V60 L50 90 L0 60 Z" fill={b} /> : null}
        {pattern === 3 ? <Path d="M0 20 L20 0 L100 80 L80 104 Z" fill={b} /> : null}
        {pattern === 4 ? <Rect x="0" y="0" width="100" height="34" fill={b} /> : null}
      </G>
      <Path d={SHIELD} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth={4} />
      <Rect x="22" y="38" width="56" height="30" rx="8" fill="rgba(0,0,0,0.55)" />
      <SvgText x="50" y="60" fontSize="22" fontWeight="900" fill="#FFFFFF" textAnchor="middle">
        {letters}
      </SvgText>
    </Svg>
  );
}
