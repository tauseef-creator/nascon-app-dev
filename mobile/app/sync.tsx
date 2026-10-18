import { Icon } from '../src/components/Icon';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ConfirmDialog } from '../src/components/ConfirmDialog';
import { Screen } from '../src/components/Screen';
import { useToast } from '../src/components/Toast';
import { Card, EmptyState, ErrorBanner, formatDateTime, InfoBanner, PillKind, PrimaryButton, SecondaryButton, SectionTitle, StatusPill } from '../src/components/ui';
import { clearResults, listQueue, listResults, QueuedAction, removeQueued, subscribeQueue, SyncResultRow } from '../src/offline/queue';
import { useSync } from '../src/offline/SyncProvider';
import { colors, radius, spacing, text, TOUCH } from '../src/theme';

const resultPill = (s: string): PillKind => (s === 'applied' ? 'applied' : s === 'duplicate' ? 'duplicate' : 'rejected');

export default function SyncScreen() {
  const sync = useSync();
  const toast = useToast();
  const [pending, setPending] = useState<QueuedAction[]>([]);
  const [results, setResults] = useState<SyncResultRow[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [discard, setDiscard] = useState<QueuedAction | null>(null);

  const load = useCallback(() => {
    listQueue().then(setPending).catch(() => {});
    listResults().then(setResults).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    return subscribeQueue(load);
  }, [load]);

  const syncNow = async () => {
    const out = await sync.syncNow();
    load();
    if (out && out.total) {
      toast(
        `Synced ${out.total}: ${out.applied} applied${out.rejected ? `, ${out.rejected} rejected` : ''}${out.duplicate ? `, ${out.duplicate} already synced` : ''}.`,
        out.rejected ? 'info' : 'success',
      );
    }
  };

  const status = !sync.online ? 'Offline' : sync.syncing ? 'Syncing' : sync.serverDown ? 'Server unreachable' : 'Online';

  return (
    <Screen title="Sync queue" back onRefresh={load} testID="sync-screen">
      <Card testID="sync-summary">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Icon name={sync.online ? 'cloud-done' : 'cloud-offline'} size={28} color={colors.text} />
          <Text style={text.title}>{status}</Text>
        </View>
        <Text style={[text.body, { marginTop: spacing.sm }]}>
          {pending.length
            ? `${pending.length} action${pending.length === 1 ? ' is' : 's are'} saved on this phone and waiting to be sent.`
            : 'Nothing is waiting. Every action has been sent to the server.'}
        </Text>
        <Text style={[text.small, { marginTop: spacing.xs }]}>
          Actions you take while offline are kept here, even if the app is closed, and are sent automatically when the connection returns.
        </Text>
        {sync.lastError ? <View style={{ marginTop: spacing.sm }}><ErrorBanner message={sync.lastError} /></View> : null}
        <PrimaryButton
          title={sync.online ? 'Sync now' : 'Sync now (needs a connection)'}
          icon="sync"
          onPress={syncNow}
          loading={sync.syncing}
          disabled={!sync.online || !pending.length}
          testID="sync-now"
          style={{ marginTop: spacing.md }}
        />
      </Card>

      <SectionTitle>Waiting to sync ({pending.length})</SectionTitle>
      {!pending.length ? (
        <EmptyState icon="checkmark-done-circle-outline" title="No pending actions" message="Scores and roster changes made offline will appear here." testID="sync-pending-empty" />
      ) : (
        pending.map((a) => (
          <Card key={a.action_id} testID={`sync-pending-${a.action_id}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
              <Text style={[text.label, { flex: 1, minWidth: 160 }]}>{a.label}</Text>
              <StatusPill kind="pending" />
            </View>
            <Text style={text.small}>
              {a.type === 'score_event' ? 'Score entry' : 'Roster change'} · saved {formatDateTime(a.queued_at)}
            </Text>
            {a.error ? <Text style={{ color: colors.danger, fontSize: 15, marginTop: 4 }}>{a.error}</Text> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
              <Pressable
                testID={`sync-details-${a.action_id}`}
                accessibilityRole="button"
                accessibilityLabel={open === a.action_id ? 'Hide technical details' : 'Show technical details'}
                onPress={() => setOpen(open === a.action_id ? null : a.action_id)}
                style={{ minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: 4 }}
              >
                <Icon name={open === a.action_id ? 'chevron-up' : 'code-slash'} size={18} color={colors.text} />
                <Text style={[text.body, { fontFamily: 'Inter_600SemiBold' }]}>{open === a.action_id ? 'Hide details' : 'Show details'}</Text>
              </Pressable>
              <SecondaryButton title="Discard" compact danger icon="trash-outline" onPress={() => setDiscard(a)} testID={`sync-discard-${a.action_id}`} />
            </View>
            {open === a.action_id ? (
              <Text selectable style={{ fontFamily: 'monospace', fontSize: 13, backgroundColor: colors.neutralBg, padding: spacing.sm, borderRadius: radius.sm, color: colors.text }}>
                {JSON.stringify({ action_id: a.action_id, type: a.type, queued_at: a.queued_at, base_version: a.base_version, payload: a.payload }, null, 2)}
              </Text>
            ) : null}
          </Card>
        ))
      )}

      <SectionTitle>Last sync results</SectionTitle>
      {!results.length ? (
        <InfoBanner message="Results appear here after queued actions are sent." />
      ) : (
        <>
          {results.map((r, i) => (
            <Card key={`${r.action_id}-${i}`} testID={`sync-result-${r.action_id}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
                <Text style={[text.label, { flex: 1, minWidth: 160 }]}>{r.label}</Text>
                <StatusPill kind={resultPill(r.status)} />
              </View>
              <Text style={[text.body, { marginTop: 4 }]}>{r.message}</Text>
              <Text style={text.small}>{formatDateTime(r.at)}</Text>
            </Card>
          ))}
          <SecondaryButton title="Clear results" icon="close" compact onPress={() => clearResults().then(load)} testID="sync-clear-results" />
        </>
      )}

      <ConfirmDialog
        visible={!!discard}
        title="Discard this action?"
        message={discard ? `"${discard.label}" will be deleted from this phone and never sent to the server.` : ''}
        confirmTitle="Discard"
        destructive
        onCancel={() => setDiscard(null)}
        onConfirm={() => {
          if (discard) removeQueued(discard.action_id).then(load);
          setDiscard(null);
          toast('Action discarded.', 'info');
        }}
        testID="discard-confirm"
      />
    </Screen>
  );
}
