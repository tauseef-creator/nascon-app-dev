import { Icon } from '../../src/components/Icon';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ClubProfile } from '../../src/api/types';
import { useAuth } from '../../src/auth/AuthContext';
import { ClubCrest } from '../../src/components/ClubCrest';
import { ClubProfileView } from '../../src/components/ClubProfileView';
import { Screen } from '../../src/components/Screen';
import { CachedNotice, EmptyState, ErrorBanner, LoadingView, SectionTitle } from '../../src/components/ui';
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
      <LinearGradient colors={['#205A28', '#17331E', colors.card]} style={{ borderRadius: 24, padding: spacing.xl, marginBottom: spacing.lg }}>
        <Icon name="shield-checkmark" size={28} color={colors.accent} />
        <Text style={[text.h1, { marginTop: spacing.md }]}>{ownId ? 'The competition' : 'Find your team'}</Text>
        <Text style={[text.small, { color: '#D5DED5', marginTop: spacing.xs }]}>{clubs.data?.clubs.length ?? 0} clubs • Players, staff and home grounds</Text>
      </LinearGradient>
      <SectionTitle>{ownId ? 'Other clubs' : 'All clubs'}</SectionTitle>
      {clubs.loading && !clubs.data ? <LoadingView label="Loading clubs…" /> : null}
      {clubs.error && !clubs.data ? <ErrorBanner message={clubs.error} onRetry={clubs.refresh} /> : null}
      {clubs.data && !others.length ? <EmptyState icon="shield-outline" title="No clubs yet" message="Clubs in your organisation will be listed here." /> : null}
      {others.length ? <View style={{ backgroundColor: 'rgba(28,28,30,0.86)', borderRadius: 24, paddingHorizontal: spacing.md, marginBottom: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)' }}>
        {others.map((c, i) => (
          <Pressable key={c.club_id} testID={`club-item-${c.club_id}`} accessibilityRole="button" accessibilityLabel={`${c.name}. Opens club profile.`} onPress={() => router.push(`/club/${c.club_id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 68, borderBottomWidth: i === others.length - 1 ? 0 : 1, borderBottomColor: colors.divider }}>
            <ClubCrest name={c.name} size={32} />
            <View style={{ flex: 1 }}><Text style={text.label}>{c.name}</Text>{c.home_venue?.name ? <Text style={[text.small, { fontSize: 11 }]}>{c.home_venue.name}</Text> : null}</View>
            <Icon name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        ))}
      </View> : null}
    </Screen>
  );
}
