import { Icon } from './Icon';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React from 'react';
import { Linking, Text, View } from 'react-native';
import { ClubProfile } from '../api/types';
import { canManageRoster, useAuth } from '../auth/AuthContext';
import { humanize } from '../hooks/useClubNames';
import { colors, spacing, text } from '../theme';
import { ClubCrest, crestColor } from './ClubCrest';
import { ManagePanel, toolsCaption } from './ManagePanel';
import { Card, EmptyState, PrimaryButton, Row, SecondaryButton, SectionTitle } from './ui';

const POS: Record<string, string> = { gk: 'Goalkeeper', df: 'Defender', mf: 'Midfielder', fw: 'Forward' };
export const positionLabel = (p: string | null | undefined) => (p ? POS[p] ?? p.toUpperCase() : '');

export function ClubProfileView({ club }: { club: ClubProfile }) {
  const { user } = useAuth();
  const players = club.players ?? club.roster ?? [];
  const manages = canManageRoster(user?.role) && (user?.role === 'super_admin' || user?.club_id === club.club_id);
  const v = club.home_venue;
  // A super admin has no club of their own, so the roster screen is told which club to open.
  const rosterHref = (user?.role === 'super_admin' && user?.club_id !== club.club_id ? `/roster?club=${encodeURIComponent(club.club_id)}` : '/roster') as '/roster';
  return (
    <View testID="club-profile">
      <View style={{ borderRadius: 24, overflow: 'hidden', marginBottom: spacing.md, backgroundColor: colors.card }}>
        <LinearGradient colors={[crestColor(club.name), '#18291D', colors.card]} locations={[0, 0.58, 1]} style={{ padding: spacing.xl, minHeight: 220, justifyContent: 'space-between' }}>
          <Text style={{ color: '#D3F7DC', fontSize: 11, letterSpacing: 1.2, fontFamily: 'Inter_700Bold' }}>{user?.club_id === club.club_id ? 'YOUR CLUB' : 'CLUB PROFILE'}</Text>
          <View style={{ alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md }}>
            <View accessible accessibilityLabel={`${club.name} crest`} style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(0,0,0,0.36)', alignItems: 'center', justifyContent: 'center' }}>
              <ClubCrest name={club.name} size={56} />
            </View>
            <Text style={[text.h1, { color: colors.white, textAlign: 'center' }]} accessibilityRole="header">{club.name}</Text>
            <Text style={[text.small, { color: '#D4D9D4' }]}>{v?.name ?? 'League club'}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.lg }}>
            <Text style={{ color: colors.white, fontFamily: 'Inter_700Bold', fontSize: 12 }}>{players.length} PLAYERS</Text>
            <Text style={{ color: '#D4D9D4', fontSize: 12 }}>•</Text>
            <Text style={{ color: colors.white, fontFamily: 'Inter_700Bold', fontSize: 12 }}>{Object.keys(club.staff ?? {}).length} STAFF</Text>
          </View>
        </LinearGradient>
      </View>

      {manages ? (
        <ManagePanel title="Manage club" caption={toolsCaption(user?.role)} testID="club-manage" description="Add, transfer, loan or release players in this club's squad.">
          <View style={{ gap: spacing.sm }}>
            <PrimaryButton title="Manage roster" icon="people" onPress={() => router.push(rosterHref)} testID="club-manage-roster" />
            <SecondaryButton title="Add a player" icon="person-add-outline" onPress={() => router.push(`${rosterHref}${rosterHref.includes('?') ? '&' : '?'}add=1` as never)} testID="club-add-player" />
          </View>
        </ManagePanel>
      ) : null}

      <SectionTitle>Home venue</SectionTitle>
      <Card testID="club-venue">
        {v?.name ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Icon name="location" size={22} color={colors.text} />
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

      <SectionTitle>Squad ({players.length})</SectionTitle>
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
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.cardHi, alignItems: 'center', justifyContent: 'center' }}><Icon name="person" size={15} color={colors.textMuted} /></View>
              <Text style={[text.label, { flex: 1, fontSize: 13 }]}>{p.name}</Text>
              <Text style={[text.small, { fontSize: 11 }]}>{positionLabel(p.position)}</Text>
            </View>
          ))}
        </Card>
      ) : (
        <EmptyState icon="people-outline" title="No players registered yet" message="Registered players will be listed here." />
      )}
    </View>
  );
}
