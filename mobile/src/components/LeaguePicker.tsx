import React from 'react';
import { ScrollView, View } from 'react-native';
import { useLeague } from '../store/LeagueContext';
import { spacing } from '../theme';
import { Chip } from './ui';

export function LeaguePicker() {
  const { leagues, league, select } = useLeague();
  if (leagues.length <= 1) return null;
  return (
    <View style={{ marginBottom: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel="Choose a league">
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {leagues.map((l) => (
          <Chip
            key={l.league_id}
            testID={`league-chip-${l.league_id}`}
            label={l.name}
            selected={league?.league_id === l.league_id}
            onPress={() => select(l.league_id)}
          />
        ))}
      </ScrollView>
    </View>
  );
}
