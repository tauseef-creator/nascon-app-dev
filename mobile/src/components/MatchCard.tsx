import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Match } from '../api/types';
import { colors, spacing, text } from '../theme';
import { formatDateTime, matchPill, PressableCard, StatusPill } from './ui';

export function MatchCard({ m }: { m: Match }) {
  const showScore = m.status === 'in_progress' || m.status === 'completed';
  const statusWord = m.status === 'in_progress' ? 'live' : m.status === 'completed' ? 'full time' : 'upcoming';
  const label = `${m.home_name} versus ${m.away_name}, ${statusWord}${showScore ? `, score ${m.home_score} to ${m.away_score}` : ''}, ${formatDateTime(m.scheduled_at)}. Opens match details.`;
  return (
    <PressableCard testID={`match-card-${m.match_id}`} label={label} onPress={() => router.push(`/match/${m.match_id}`)}>
      <View style={styles.top}>
        <StatusPill kind={matchPill(m.status)} />
        <Text style={[text.small, { flexShrink: 1, textAlign: 'right' }]} numberOfLines={1}>
          {formatDateTime(m.scheduled_at)}
        </Text>
      </View>
      <View style={styles.teamRow}>
        <Text style={[text.label, styles.team]} numberOfLines={2}>
          {m.home_name}
        </Text>
        <Text style={styles.score}>{showScore ? m.home_score : ''}</Text>
      </View>
      <View style={styles.teamRow}>
        <Text style={[text.label, styles.team]} numberOfLines={2}>
          {m.away_name}
        </Text>
        <Text style={styles.score}>{showScore ? m.away_score : ''}</Text>
      </View>
      <View style={styles.bottom}>
        {m.venue ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}>
            <Ionicons name="location-outline" size={16} color={colors.textMuted} />
            <Text style={text.small} numberOfLines={1}>
              {m.venue}
            </Text>
          </View>
        ) : (
          <View />
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={[text.small, { fontWeight: '700' }]}>Details</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </View>
      </View>
    </PressableCard>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.sm },
  teamRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  team: { flex: 1, fontSize: 18 },
  score: { fontSize: 26, fontWeight: '900', color: colors.text, minWidth: 40, textAlign: 'right' },
  bottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm, gap: spacing.sm },
});
