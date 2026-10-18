// nascon://entity/{entity_id} (FR-4.1 hybrid deep links, spec 6.3). Opens the right screen in place
// so the link works on a cold start and without signing in:
//   match-*  -> match live screen     club-* -> club profile
//   player-* -> athlete view          cs-session-* -> co-stream
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { AthleteView } from '../../src/components/AthleteView';
import { CoStreamView } from '../../src/components/CoStreamView';
import { Screen } from '../../src/components/Screen';
import { EmptyState, PrimaryButton } from '../../src/components/ui';
import { entityKind } from '../../src/realtime/urls';
import ClubScreen from '../club/[id]';
import MatchDetail from '../match/[id]';

export default function EntityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const eid = String(id ?? '');
  switch (entityKind(eid)) {
    case 'match':
      return <MatchDetail />;
    case 'club':
      return <ClubScreen />;
    case 'player':
      return <AthleteView playerId={eid} />;
    case 'costream':
      return (
        <Screen title="Co-stream" subtitle={eid} back testID="stream-screen">
          <CoStreamView sessionId={eid} />
        </Screen>
      );
    default:
      return (
        <Screen title="Link" back testID="entity-unknown">
          <EmptyState icon="help-circle" title="We can't open this link" message={`"${eid}" is not a match, club, athlete or co-stream.`} testID="entity-unknown-empty" />
          <PrimaryButton title="Go to fixtures" onPress={() => router.replace('/')} testID="entity-home" />
        </Screen>
      );
  }
}
