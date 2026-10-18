import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { api } from '../../src/api/client';
import { ClubProfile } from '../../src/api/types';
import { useAuth } from '../../src/auth/AuthContext';
import { ClubProfileView } from '../../src/components/ClubProfileView';
import { QrCard } from '../../src/components/QrCard';
import { Screen } from '../../src/components/Screen';
import { Card, CachedNotice, ErrorBanner, InfoBanner, LoadingView, Row, SecondaryButton, SectionTitle } from '../../src/components/ui';
import { text } from '../../src/theme';

type GuestClub = { club_id: string; name: string; players: { player_id: string; name: string; position: string }[] };
import { useCachedQuery } from '../../src/hooks/useCachedQuery';

export default function ClubScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const q = useCachedQuery<ClubProfile>(id ? `club:${id}` : null, id ? `/api/v1/clubs/${encodeURIComponent(id)}` : null);
  const guestBlocked = !user && !q.data && (q.errorCode === 'UNAUTHENTICATED' || q.errorCode === 'FORBIDDEN');
  // Guests (deep link, QR) get the public summary: name and squad.
  const [guest, setGuest] = useState<GuestClub | null>(null);
  useEffect(() => {
    if (!guestBlocked || !id) return;
    api<GuestClub>(`/api/v1/guest/clubs/${encodeURIComponent(id)}`, { auth: false })
      .then(setGuest)
      .catch(() => setGuest(null));
  }, [guestBlocked, id]);
  return (
    <Screen title={q.data?.name ?? guest?.name ?? 'Club'} back onRefresh={q.refresh} refreshing={q.refreshing} testID="club-screen">
      {q.fromCache && q.updatedAt ? <CachedNotice updatedAt={q.updatedAt} /> : null}
      {q.loading && !q.data ? <LoadingView label="Loading club…" /> : null}
      {guestBlocked ? (
        <>
          <InfoBanner message="Sign in to see this club's full profile and squad." testID="club-guest" />
          <SecondaryButton title="Sign in" icon="log-in-outline" onPress={() => router.push('/login')} testID="club-guest-signin" />
          {guest ? (
            <>
              <SectionTitle>Squad</SectionTitle>
              <Card testID="club-guest-squad">
                {guest.players.length ? (
                  guest.players.map((pl) => <Row key={pl.player_id} label={pl.name} value={String(pl.position ?? '').toUpperCase()} />)
                ) : (
                  <Text style={text.muted}>No players listed yet.</Text>
                )}
              </Card>
            </>
          ) : null}
        </>
      ) : q.error && !q.data ? (
        <ErrorBanner message={q.error} onRetry={q.refresh} />
      ) : null}
      {q.data ? <ClubProfileView club={q.data} /> : null}
      {id ? <QrCard entityId={id} title="Share this club" /> : null}
    </Screen>
  );
}
