import { Icon } from './Icon';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Match } from '../api/types';
import { ClubCrest } from './ClubCrest';
import { colors, spacing } from '../theme';
import { OFF_SCHEDULE, statusLabel } from '../utils/matchStatus';
import { formatDateTime, formatTime } from './ui';

export function MatchCard({ m, testID }: { m: Match; testID?: string }) {
  const live = m.status === 'in_progress';
  const off = OFF_SCHEDULE[m.status];
  // Abandoned matches keep the score reached before play stopped.
  const showScore = live || m.status === 'completed' || m.status === 'abandoned';
  const statusWord = statusLabel(m.status).toLowerCase();
  const id = testID ?? `match-card-${m.match_id}`;
  const label = `${m.home_name} versus ${m.away_name}, ${statusWord}${showScore ? `, score ${m.home_score} to ${m.away_score}` : ''}, ${formatDateTime(m.scheduled_at)}. Opens match details.`;
  const homeLeads = showScore && m.home_score > m.away_score;
  const awayLeads = showScore && m.away_score > m.home_score;
  return (
    <Pressable
      testID={id}
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
          ) : off ? (
            <View style={styles.liveRow} testID={`${id}-status`}>
              <Icon name={off.icon} size={14} color={off.color} />
              <Text style={[styles.offText, { color: off.color }]}>{statusLabel(m.status)}</Text>
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
  date: { color: '#8E8E93', fontSize: 11, fontFamily: 'Inter_500Medium', textAlign: 'center', marginBottom: 3 },
  matchRow: { flexDirection: 'row', alignItems: 'center' },
  club: { width: 76, alignItems: 'center', gap: 4 },
  clubName: { color: colors.textMuted, fontSize: 11, lineHeight: 14, fontFamily: 'Inter_500Medium', textAlign: 'center' },
  score: { color: colors.text, fontSize: 32, lineHeight: 38, fontFamily: 'Inter_800ExtraBold', letterSpacing: -1, minWidth: 30, textAlign: 'center', fontVariant: ['tabular-nums'] },
  scoreDim: { color: colors.textMuted },
  middle: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.xs },
  status: { color: colors.text, fontSize: 15, fontFamily: 'Inter_700Bold', letterSpacing: -0.2, textAlign: 'center', fontVariant: ['tabular-nums'] },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.live },
  liveText: { color: colors.live, fontSize: 14, fontFamily: 'Inter_800ExtraBold', letterSpacing: 0.6 },
  offText: { fontSize: 13, fontFamily: 'Inter_800ExtraBold', letterSpacing: 0.3 },
  venueText: { color: '#8E8E93', fontSize: 11, fontFamily: 'Inter_500Medium', marginTop: 3, textAlign: 'center' },
});
