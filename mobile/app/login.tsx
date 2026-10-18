import { Icon } from '../src/components/Icon';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { errorText } from '../src/api/errors';
import { getBaseUrl } from '../src/api/client';
import { useAuth } from '../src/auth/AuthContext';
import { AppMark } from '../src/components/AppMark';
import { SyncBar } from '../src/components/SyncBar';
import { Card, Chip, ErrorBanner, Field, InfoBanner, PrimaryButton, SecondaryButton } from '../src/components/ui';
import { colors, radius, spacing, text, TOUCH } from '../src/theme';

const DEMO = [
  { label: 'Organizer', email: 'organizer@nascon.test' },
  { label: 'Club Manager', email: 'manager@nascon.test' },
  { label: 'Viewer', email: 'viewer@nascon.test' },
  { label: 'Player', email: 'player@nascon.test' },
  { label: 'Super-Admin', email: 'admin@nascon.test' },
];

export default function Login() {
  const { login, sessionExpired } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const emailErr = touched && !/^\S+@\S+\.\S+$/.test(email.trim()) ? 'Enter your email address, for example name@club.com.' : null;
  const pwErr = touched && !password ? 'Enter your password.' : null;

  const submit = async () => {
    setTouched(true);
    if (!/^\S+@\S+\.\S+$/.test(email.trim()) || !password) return;
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (e) {
      console.error('[login] failed', e);
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'left', 'right']}>
      <LinearGradient pointerEvents="none" colors={[colors.headerTint, colors.bg]} style={styles.wash} />
      <SyncBar />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <View style={styles.logo} accessible accessibilityLabel="NaSCon League logo">
              <AppMark size={72} />
            </View>
            <Text style={text.h1} accessibilityRole="header">
              NaSCon League
            </Text>
            <Text style={[text.muted, { textAlign: 'center' }]}>Fixtures, live scores, standings and the club store.</Text>
          </View>

          {sessionExpired ? <InfoBanner tone="warning" icon="time-outline" message="Your session has expired. Please sign in again." /> : null}

          <Card>
            <Field
              label="Email"
              testID="login-email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              placeholder="name@nascon.test"
              returnKeyType="next"
              error={emailErr}
            />
            <Text style={[text.small, { marginBottom: spacing.xs, fontFamily: 'Inter_600SemiBold' }]}>Password</Text>
            <View style={[styles.pwRow, pwErr ? { borderColor: colors.danger } : null]}>
              <TextInput
                testID="login-password"
                accessibilityLabel="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!show}
                autoCapitalize="none"
                placeholder="Your password"
                placeholderTextColor="#636366"
                style={styles.pwInput}
                returnKeyType="go"
                onSubmitEditing={submit}
              />
              <Pressable
                testID="login-toggle-password"
                accessibilityRole="button"
                accessibilityLabel={show ? 'Hide password' : 'Show password'}
                onPress={() => setShow((s) => !s)}
                style={styles.eye}
              >
                <Icon name={show ? 'eye-off' : 'eye'} size={24} color={colors.textMuted} />
                <Text style={{ color: colors.textMuted, fontSize: 14, fontFamily: 'Inter_600SemiBold' }}>{show ? 'Hide' : 'Show'}</Text>
              </Pressable>
            </View>
            {pwErr ? <Text style={{ color: colors.danger, fontSize: 14, marginTop: 4 }}>{pwErr}</Text> : null}
            <View style={{ height: spacing.lg }} />
            {error ? <ErrorBanner message={error} testID="login-error" /> : null}
            <PrimaryButton title="Sign in" icon="log-in-outline" onPress={submit} loading={busy} testID="login-submit" />
          </Card>

          <Text style={[text.section, { marginTop: spacing.md, marginBottom: spacing.sm }]}>Demo accounts (tap to fill)</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {DEMO.map((d) => (
              <Chip
                key={d.email}
                testID={`login-demo-${d.label.toLowerCase().replace(/[^a-z]/g, '')}`}
                label={d.label}
                accessibilityLabel={`Fill in the ${d.label} demo account`}
                selected={email === d.email}
                onPress={() => {
                  setEmail(d.email);
                  setPassword('Nascon@26');
                  setError(null);
                }}
              />
            ))}
          </View>

          <SecondaryButton
            title="Server settings"
            icon="settings-outline"
            onPress={() => router.push('/settings')}
            testID="login-settings"
            style={{ marginTop: spacing.lg }}
            accessibilityHint="Change the server address the app connects to"
          />
          <Text style={[text.small, { textAlign: 'center', marginTop: spacing.sm }]} testID="login-server">
            Server: {getBaseUrl()}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wash: { position: 'absolute', top: 0, left: 0, right: 0, height: 360 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  brand: { alignItems: 'center', marginVertical: spacing.lg, gap: spacing.xs },
  logo: { marginBottom: spacing.sm },

  pwRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.cardHi,
  },
  pwInput: { flex: 1, minHeight: TOUCH + 4, paddingHorizontal: spacing.md, fontSize: 16, color: colors.text },
  eye: { minWidth: 72, minHeight: TOUCH, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4, paddingRight: spacing.sm },
});
