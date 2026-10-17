import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ClubProfile } from '../../src/api/types';
import { ClubProfileView } from '../../src/components/ClubProfileView';
import { Screen } from '../../src/components/Screen';
import { CachedNotice, ErrorBanner, LoadingView } from '../../src/components/ui';
import { useCachedQuery } from '../../src/hooks/useCachedQuery';

export default function ClubScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useCachedQuery<ClubProfile>(id ? `club:${id}` : null, id ? `/api/v1/clubs/${encodeURIComponent(id)}` : null);
  return (
    <Screen title={q.data?.name ?? 'Club'} back onRefresh={q.refresh} refreshing={q.refreshing} testID="club-screen">
      {q.fromCache && q.updatedAt ? <CachedNotice updatedAt={q.updatedAt} /> : null}
      {q.loading && !q.data ? <LoadingView label="Loading club…" /> : null}
      {q.error && !q.data ? <ErrorBanner message={q.error} onRetry={q.refresh} /> : null}
      {q.data ? <ClubProfileView club={q.data} /> : null}
    </Screen>
  );
}
