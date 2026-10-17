import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Match } from '../api/types';
import { useBrand } from '../auth/AuthContext';
import { colors, onColor, spacing } from '../theme';
import { formatDateTime, formatTime, PressableCard } from './ui';

function ClubMark({ name, accent }: { name: string; accent: string }) {
  const letters = name.split(/\s+/).filter(Boolean).slice(-2).map((part) => part[0]?.toUpperCase()).join('');
  return (
    <View style={[styles.mark, { backgroundColor: accent }]} accessible={false}>
      <Text style={[styles.markText, { color: onColor(accent) }]}>{letters || 'FC'}</Text>
    </View>
  );
}

export function MatchCard({ m }: { m: Match }) {
  const brand = useBrand();
  const live = m.status === 'in_progress';
  const showScore = live || m.status === 'completed';
  const statusWord = live ? 'live' : m.status === 'completed' ? 'full time' : 'upcoming';
  const label = `${m.home_name} versus ${m.away_name}, ${statusWord}${showScore ? `, score ${m.home_score} to ${m.away_score}` : ''}, ${formatDateTime(m.scheduled_at)}. Opens match details.`;
  const homeLeads = showScore && m.home_score > m.away_score;
  const awayLeads = showScore && m.away_score > m.home_score;
  return (
    <PressableCard testID={`match-card-${m.match_id}`} label={label} onPress={() => router.push(`/match/${m.match_id}`)} style={[styles.card, live && styles.liveCard]}>
      <Text style={styles.date} numberOfLines={1}>{formatDateTime(m.scheduled_at)}</Text>
      <View style={styles.matchRow}>
        <View style={styles.club}>
          <ClubMark name={m.home_name} accent={brand.primary} />
          <Text style={styles.clubName} numberOfLines={2}>{m.home_name}</Text>
        </View>
        {showScore ? <Text style={[styles.score, awayLeads && styles.scoreDim]}>{m.home_score}</Text> : null}
        <View style={styles.middle}>
          {live ? (
            <View style={styles.liveRow}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          ) : (
            <Text style={styles.status}>{showScore ? 'Final' : formatTime(m.scheduled_at)}</Text>
          )}
          {m.venue ? <Text style={styles.venueText} numberOfLines={1}>{m.venue}</Text> : null}
        </View>
        {showScore ? <Text style={[styles.score, homeLeads && styles.scoreDim]}>{m.away_score}</Text> : null}
        <View style={styles.club}>
          <ClubMark name={m.away_name} accent={brand.secondary} />
          <Text style={styles.clubName} numberOfLines={2}>{m.away_name}</Text>
        </View>
      </View>
    </PressableCard>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: spacing.md, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  liveCard: { borderWidth: 1, borderColor: 'rgba(255,69,58,0.45)', backgroundColor: '#221416' },
  date: { color: colors.textMuted, fontSize: 12, fontWeight: '600', textAlign: 'center', marginBottom: spacing.xs },
  matchRow: { flexDirection: 'row', alignItems: 'center' },
  club: { width: 78, alignItems: 'center', gap: 6 },
  mark: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  markText: { fontSize: 12, fontWeight: '900' },
  clubName: { color: colors.text, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  score: { color: colors.text, fontSize: 34, fontWeight: '800', minWidth: 30, textAlign: 'center', fontVariant: ['tabular-nums'] },
  scoreDim: { color: colors.textMuted },
  middle: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.xs },
  status: { color: colors.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.live },
  liveText: { color: colors.live, fontSize: 14, fontWeight: '800', letterSpacing: 0.6 },
  venueText: { color: colors.textMuted, fontSize: 11, marginTop: 3, textAlign: 'center' },
});
