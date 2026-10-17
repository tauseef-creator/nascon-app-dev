import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Match } from '../api/types';
import { useBrand } from '../auth/AuthContext';
import { colors, spacing } from '../theme';
import { formatDateTime, formatTime, matchPill, PressableCard, StatusPill } from './ui';

function ClubMark({ name, accent }: { name: string; accent: string }) {
  const letters = name.split(/\s+/).filter(Boolean).slice(-2).map((part) => part[0]?.toUpperCase()).join('');
  return (
    <View style={[styles.mark, { borderColor: accent }]} accessible={false}>
      <Text style={[styles.markText, { color: accent }]}>{letters || 'FC'}</Text>
    </View>
  );
}

export function MatchCard({ m }: { m: Match }) {
  const brand = useBrand();
  const showScore = m.status === 'in_progress' || m.status === 'completed';
  const statusWord = m.status === 'in_progress' ? 'live' : m.status === 'completed' ? 'full time' : 'upcoming';
  const label = `${m.home_name} versus ${m.away_name}, ${statusWord}${showScore ? `, score ${m.home_score} to ${m.away_score}` : ''}, ${formatDateTime(m.scheduled_at)}. Opens match details.`;
  return (
    <PressableCard testID={`match-card-${m.match_id}`} label={label} onPress={() => router.push(`/match/${m.match_id}`)} style={styles.card}>
      <View style={styles.meta}>
        <StatusPill kind={matchPill(m.status)} />
        <Text style={styles.date} numberOfLines={1}>{formatDateTime(m.scheduled_at)}</Text>
      </View>
      <View style={styles.matchRow}>
        <View style={styles.club}>
          <ClubMark name={m.home_name} accent={brand.primaryText} />
          <Text style={styles.clubName} numberOfLines={2}>{m.home_name}</Text>
        </View>
        <View style={styles.middle}>
          <Text style={styles.result}>{showScore ? `${m.home_score}  :  ${m.away_score}` : formatTime(m.scheduled_at)}</Text>
          <Text style={styles.middleNote}>{showScore ? statusWord.toUpperCase() : 'KICK OFF'}</Text>
        </View>
        <View style={styles.club}>
          <ClubMark name={m.away_name} accent={brand.primaryText} />
          <Text style={styles.clubName} numberOfLines={2}>{m.away_name}</Text>
        </View>
      </View>
      {m.venue ? (
        <View style={styles.venue}>
          <Ionicons name="location-outline" size={14} color={colors.textMuted} />
          <Text style={styles.venueText} numberOfLines={1}>{m.venue}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </View>
      ) : null}
    </PressableCard>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, marginBottom: spacing.sm },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  date: { color: colors.textMuted, fontSize: 12, flexShrink: 1, textAlign: 'right' },
  matchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  club: { flex: 1, alignItems: 'center', gap: 5 },
  mark: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, backgroundColor: '#1E2A3D', alignItems: 'center', justifyContent: 'center' },
  markText: { fontSize: 11, fontWeight: '900' },
  clubName: { color: colors.text, fontSize: 13, fontWeight: '700', textAlign: 'center', minHeight: 32 },
  middle: { width: 112, alignItems: 'center' },
  result: { color: colors.text, fontSize: 23, fontWeight: '800', textAlign: 'center' },
  middleNote: { color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginTop: 2 },
  venue: { borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 4 },
  venueText: { color: colors.textMuted, fontSize: 12, flex: 1 },
});
