import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Linking, Text, View } from 'react-native';
import { ClubProfile } from '../api/types';
import { canManageRoster, useAuth, useBrand } from '../auth/AuthContext';
import { humanize } from '../hooks/useClubNames';
import { colors, spacing, text } from '../theme';
import { Card, EmptyState, PrimaryButton, Row, SecondaryButton, SectionTitle } from './ui';

const POS: Record<string, string> = { gk: 'Goalkeeper', df: 'Defender', mf: 'Midfielder', fw: 'Forward' };
export const positionLabel = (p: string | null | undefined) => (p ? POS[p] ?? p.toUpperCase() : '');

export function ClubProfileView({ club }: { club: ClubProfile }) {
  const { user } = useAuth();
  const brand = useBrand();
  const players = club.players ?? club.roster ?? [];
  const manages = canManageRoster(user?.role) && (user?.role === 'super_admin' || user?.club_id === club.club_id);
  const v = club.home_venue;
  const initials = club.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return (
    <View testID="club-profile">
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View
            style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: brand.primary, alignItems: 'center', justifyContent: 'center' }}
            accessible
            accessibilityLabel={`${club.name} crest`}
          >
            <Text style={{ color: brand.onPrimary, fontWeight: '900', fontSize: 20 }}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={text.h1} accessibilityRole="header">
              {club.name}
            </Text>
            {user?.club_id === club.club_id ? <Text style={[text.small, { fontWeight: '700' }]}>Your club</Text> : null}
          </View>
        </View>
        {manages ? (
          <PrimaryButton title="Manage roster" icon="people" onPress={() => router.push('/roster')} testID="club-manage-roster" style={{ marginTop: spacing.lg }} />
        ) : null}
      </Card>

      <SectionTitle>Home venue</SectionTitle>
      <Card testID="club-venue">
        {v?.name ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Ionicons name="location" size={22} color={colors.text} />
              <Text style={[text.label, { flex: 1 }]}>{v.name}</Text>
            </View>
            {v.lat != null && v.lng != null ? (
              <>
                <Text style={[text.small, { marginTop: 4 }]}>
                  {v.lat.toFixed(4)}, {v.lng.toFixed(4)}
                </Text>
                <SecondaryButton
                  title="Open in maps"
                  icon="map-outline"
                  compact
                  onPress={() => Linking.openURL(`geo:${v.lat},${v.lng}?q=${v.lat},${v.lng}(${encodeURIComponent(v.name ?? club.name)})`).catch(() => {})}
                  testID="club-open-map"
                  style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}
                />
              </>
            ) : null}
          </>
        ) : (
          <Text style={text.muted}>No home venue listed yet.</Text>
        )}
      </Card>

      <SectionTitle>Staff</SectionTitle>
      <Card testID="club-staff">
        {club.staff && Object.keys(club.staff).length ? (
          Object.entries(club.staff).map(([role, person]) => <Row key={role} label={humanize(role)} value={String(person)} />)
        ) : (
          <Text style={text.muted}>No staff listed yet.</Text>
        )}
      </Card>

      {club.social && Object.keys(club.social).length ? (
        <>
          <SectionTitle>Social</SectionTitle>
          <Card testID="club-social">
            {Object.entries(club.social).map(([k, val]) => (
              <Row key={k} label={k === 'x' ? 'X (Twitter)' : humanize(k)} value={String(val)} />
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle>Players ({players.length})</SectionTitle>
      {players.length ? (
        <Card testID="club-players">
          {players.map((p, i) => (
            <View
              key={p.player_id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                minHeight: 48,
                gap: spacing.md,
                borderBottomWidth: i === players.length - 1 ? 0 : 1,
                borderBottomColor: colors.divider,
              }}
              accessible
              accessibilityLabel={`${p.name}, ${positionLabel(p.position)}${p.role ? `, ${humanize(p.role)}` : ''}`}
            >
              <Ionicons name="person-circle-outline" size={28} color={colors.textMuted} />
              <Text style={[text.label, { flex: 1 }]}>{p.name}</Text>
              <Text style={text.small}>{positionLabel(p.position)}</Text>
            </View>
          ))}
        </Card>
      ) : (
        <EmptyState icon="people-outline" title="No players registered yet" message="Registered players will be listed here." />
      )}
    </View>
  );
}
