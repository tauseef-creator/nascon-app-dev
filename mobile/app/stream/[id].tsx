// nascon://stream/{session_id}: opens the co-stream directly (spec 6.3). Works signed out.
import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { CoStreamView } from '../../src/components/CoStreamView';
import { Screen } from '../../src/components/Screen';

export default function StreamScreen() {
  const { id, invite } = useLocalSearchParams<{ id: string; invite?: string }>();
  const sid = String(id ?? '');
  return (
    <Screen title="Co-stream" subtitle={sid} back testID="stream-screen">
      <CoStreamView sessionId={sid} inviteToken={invite ? String(invite) : undefined} />
    </Screen>
  );
}
