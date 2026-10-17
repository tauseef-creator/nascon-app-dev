import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Match } from '../api/types';
import { ClubCrest } from './ClubCrest';
import { colors, spacing } from '../theme';
import { formatDateTime, formatTime } from './ui';

export function MatchCard({ m }: { m: Match }) {
  const live = m.status === 'in_progress';
  const showScore = live || m.status === 'completed';
  const statusWord = live ? 'live' : m.status === 'completed' ? 'full time' : 'upcoming';
  const label = `${m.home_name} versus ${m.away_name}, ${statusWord}${showScore ? `, score ${m.home_score} to ${m.away_score}` : ''}, ${formatDateTime(m.scheduled_at)}. Opens match details.`;
  const homeLeads = showScore && m.home_score > m.away_score;
  const awayLeads = showScore && m.away_score > m.home_score;
  return (
    <Pressable
      testID={`match-card-${m.match_id}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push(`/match/${m.match_id}`)}
      style={({ pressed }) => [styles.card, pressed && { backgroundColor: 'rgba(255,255,255,0.06)' }]}
    >
      <View style={styles.matchRow}>
        <View style={styles.club}>
          <ClubCrest name={m.home_name} size={32} />
          <Text style={styles.clubName} numberOfLines={2}>{m.home_name}</Text>
        </View>
        {showScore ? <Text style={[styles.score, awayLeads && styles.scoreDim]}>{m.home_score}</Text> : null}
        <View style={styles.middle}>
          <Text style={styles.date} numberOfLines={1}>{formatDateTime(m.scheduled_at).split(',')[0]}</Text>
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
          <ClubCrest name={m.away_name} size={32} />
          <Text style={styles.clubName} numberOfLines={2}>{m.away_name}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: spacing.md, marginHorizontal: spacing.md, minHeight: 84, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  date: { color: '#6E6E73', fontSize: 11, fontWeight: '600', textAlign: 'center', marginBottom: 3 },
  matchRow: { flexDirection: 'row', alignItems: 'center' },
  club: { width: 76, alignItems: 'center', gap: 4 },
  clubName: { color: colors.textMuted, fontSize: 11, fontWeight: '600', textAlign: 'center' },
  score: { color: colors.text, fontSize: 30, fontWeight: '800', minWidth: 30, textAlign: 'center', fontVariant: ['tabular-nums'] },
  scoreDim: { color: colors.textMuted },
  middle: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.xs },
  status: { color: colors.text, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.live },
  liveText: { color: colors.live, fontSize: 14, fontWeight: '800', letterSpacing: 0.6 },
  venueText: { color: '#6E6E73', fontSize: 11, marginTop: 3, textAlign: 'center' },
});
