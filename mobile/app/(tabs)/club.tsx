import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Text, View } from 'react-native';
import { ClubProfile } from '../../src/api/types';
import { useAuth } from '../../src/auth/AuthContext';
import { ClubCrest } from '../../src/components/ClubCrest';
import { ClubProfileView } from '../../src/components/ClubProfileView';
import { Screen } from '../../src/components/Screen';
import { CachedNotice, EmptyState, ErrorBanner, LoadingView, PressableCard, SectionTitle } from '../../src/components/ui';
import { useCachedQuery } from '../../src/hooks/useCachedQuery';
import { useClubs } from '../../src/hooks/useClubNames';
import { colors, spacing, text } from '../../src/theme';

export default function ClubTab() {
  const { user } = useAuth();
  const clubs = useClubs();
  const ownId = user?.club_id ?? null;
  const own = useCachedQuery<ClubProfile>(ownId ? `club:${ownId}` : null, ownId ? `/api/v1/clubs/${encodeURIComponent(ownId)}` : null);
  const others = (clubs.data?.clubs ?? []).filter((c) => c.club_id !== ownId);

  const refresh = () => {
    clubs.refresh();
    if (ownId) own.refresh();
  };

  return (
    <Screen title={ownId ? 'My club' : 'Clubs'} onRefresh={refresh} refreshing={clubs.refreshing || own.refreshing} testID="club-tab">
      {(own.fromCache && own.updatedAt) || (clubs.fromCache && clubs.updatedAt) ? <CachedNotice updatedAt={(own.updatedAt ?? clubs.updatedAt)!} /> : null}
      {ownId ? (
        <>
          {own.loading && !own.data ? <LoadingView label="Loading your club…" /> : null}
          {own.error && !own.data ? <ErrorBanner message={own.error} onRetry={own.refresh} /> : null}
          {own.data ? <ClubProfileView club={own.data} /> : null}
        </>
      ) : null}
      <SectionTitle>{ownId ? 'Other clubs' : 'All clubs'}</SectionTitle>
      {clubs.loading && !clubs.data ? <LoadingView label="Loading clubs…" /> : null}
      {clubs.error && !clubs.data ? <ErrorBanner message={clubs.error} onRetry={clubs.refresh} /> : null}
      {clubs.data && !others.length ? <EmptyState icon="shield-outline" title="No clubs yet" message="Clubs in your organisation will be listed here." /> : null}
      {others.map((c) => (
        <PressableCard key={c.club_id} testID={`club-item-${c.club_id}`} label={`${c.name}. Opens club profile.`} onPress={() => router.push(`/club/${c.club_id}`)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <ClubCrest name={c.name} size={34} />
            <View style={{ flex: 1 }}>
              <Text style={text.label}>{c.name}</Text>
              {c.home_venue?.name ? <Text style={text.small}>{c.home_venue.name}</Text> : null}
            </View>
            <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
          </View>
        </PressableCard>
      ))}
    </Screen>
  );
}
