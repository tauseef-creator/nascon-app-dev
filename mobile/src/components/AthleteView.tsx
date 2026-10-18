// Athlete view opened by nascon://entity/player-* (FR-3.1): career record, clubs, upcoming
// fixtures, VOD archive, followers and follow / unfollow, plus the player's QR code.
// GET /api/v1/athletes/{id} (sign-in optional), falling back to the guest summary
// GET /api/v1/guest/players/{id}.
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { api } from '../api/client';
import { errorText } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import { forDevice } from '../realtime/urls';
import { colors, spacing, text } from '../theme';
import { Icon } from './Icon';
import { QrCard } from './QrCard';
import { Screen } from './Screen';
import { useToast } from './Toast';
import { Card, ErrorBanner, formatDateTime, InfoBanner, LoadingView, PrimaryButton, Row, SecondaryButton, SectionTitle } from './ui';

type Profile = {
  player_id: string;
  name: string;
  position?: string | null;
  club_id?: string | null;
  club_name?: string | null;
  clubs?: { club_id: string; name?: string; role?: string }[];
  career?: Record<string, any>;
  upcoming_fixtures?: { match_id: string; home_team_id: string; away_team_id: string; scheduled_at: string | null; venue?: string | null }[];
  vods?: { vod_id: string; duration_s?: number; recorded_at?: string; created_at?: string; playback_url?: string | null }[];
  follower_count?: number;
  following?: boolean | null;
};

export function AthleteView({ playerId }: { playerId: string }) {
  const { user } = useAuth();
  const toast = useToast();
  const [p, setP] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const enc = encodeURIComponent(playerId);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setP(await api<Profile>(`/api/v1/athletes/${enc}`));
      setError(null);
    } catch (e: any) {
      if (e?.code === 'PLAYER_NOT_FOUND') setError(errorText(e));
      else {
        try {
          setP(await api<Profile>(`/api/v1/guest/players/${enc}`, { auth: false }));
          setError(null);
        } catch (e2) {
          setError(errorText(e2));
        }
      }
    } finally {
      setLoading(false);
    }
  }, [enc]);
  useEffect(() => {
    load();
  }, [load]);

  const toggleFollow = async () => {
    if (!user) return router.push('/login');
    if (!p) return;
    setBusy(true);
    try {
      const r = await api<{ following: boolean; follower_count: number }>(`/api/v1/athletes/${enc}/follow`, { method: p.following ? 'DELETE' : 'POST' });
      setP({ ...p, following: r.following, follower_count: r.follower_count });
      Haptics.selectionAsync().catch(() => {});
      toast(r.following ? `You follow ${p.name}.` : `You no longer follow ${p.name}.`);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const clubs = p?.clubs?.length ? p.clubs : p?.club_id ? [{ club_id: p.club_id, name: p.club_name ?? p.club_id }] : [];
  const career = p?.career ?? null;
  const counts = career ? Object.entries(career).filter(([, v]) => typeof v === 'number') : [];

  return (
    <Screen title={p?.name ?? 'Athlete'} subtitle="Athlete" back onRefresh={load} refreshing={false} testID="athlete-screen">
      {!user ? <InfoBanner message="You are viewing as a guest. Sign in to follow athletes." testID="athlete-guest" /> : null}
      {loading && !p ? <LoadingView label="Loading athlete…" /> : null}
      {error && !p ? <ErrorBanner message={error} onRetry={load} testID="athlete-error" /> : null}
      {p ? (
        <Card testID="athlete-profile">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md }}>
            <Icon name="person-circle" size={48} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={text.title}>{p.name}</Text>
              <Text style={text.small}>
                {[p.position ? String(p.position).toUpperCase() : null, p.follower_count != null ? `${p.follower_count} follower${p.follower_count === 1 ? '' : 's'}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          </View>
          {user ? (
            p.following ? (
              <SecondaryButton title="Following" icon="checkmark" onPress={toggleFollow} loading={busy} testID="athlete-follow" accessibilityLabel={`Unfollow ${p.name}`} />
            ) : (
              <PrimaryButton title="Follow" icon="add" onPress={toggleFollow} loading={busy} testID="athlete-follow" accessibilityLabel={`Follow ${p.name}`} />
            )
          ) : (
            <SecondaryButton title="Sign in to follow" icon="log-in-outline" onPress={() => router.push('/login')} testID="athlete-signin" />
          )}
        </Card>
      ) : null}
      {counts.length ? (
        <>
          <SectionTitle>Career record</SectionTitle>
          <Card testID="athlete-career">
            {counts.map(([k, v]) => (
              <Row key={k} label={k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())} value={String(v)} />
            ))}
          </Card>
        </>
      ) : null}
      {clubs.length ? (
        <>
          <SectionTitle>Clubs</SectionTitle>
          <Card testID="athlete-clubs">
            {clubs.map((c) => (
              <Row key={c.club_id} label={c.name ?? c.club_id} value={c.role ?? ''} />
            ))}
          </Card>
        </>
      ) : null}
      {p?.upcoming_fixtures?.length ? (
        <>
          <SectionTitle>Upcoming fixtures</SectionTitle>
          <Card testID="athlete-fixtures">
            {p.upcoming_fixtures.slice(0, 5).map((f) => (
              <Row key={f.match_id} label={`${f.home_team_id} vs ${f.away_team_id}`} value={formatDateTime(f.scheduled_at)} />
            ))}
          </Card>
        </>
      ) : null}
      {p?.vods?.length ? (
        <>
          <SectionTitle>Past streams</SectionTitle>
          <Card testID="athlete-vods">
            {p.vods.slice(0, 10).map((v, i) => {
              const url = forDevice(v.playback_url);
              return (
                <View key={v.vod_id} style={{ marginBottom: spacing.sm }}>
                  <Row label={`Stream ${i + 1}${v.duration_s ? ` (${Math.round(v.duration_s / 60)} min)` : ''}`} value={formatDateTime(v.recorded_at ?? v.created_at)} />
                  {url ? (
                    <SecondaryButton compact title="Watch" icon="play" onPress={() => Linking.openURL(url)} testID={`athlete-vod-${v.vod_id}`} accessibilityLabel={`Watch stream ${i + 1}`} />
                  ) : null}
                </View>
              );
            })}
          </Card>
        </>
      ) : null}
      <QrCard entityId={playerId} title="Share this athlete" />
    </Screen>
  );
}
