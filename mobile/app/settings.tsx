import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { DEFAULT_BASE_URL, getBaseUrl, normalizeBaseUrl, saveBaseUrl, testConnection } from '../src/api/client';
import { Screen } from '../src/components/Screen';
import { useToast } from '../src/components/Toast';
import { Card, Chip, ErrorBanner, Field, InfoBanner, PrimaryButton, SecondaryButton } from '../src/components/ui';
import { getDeviceId } from '../src/offline/db';
import { spacing, text } from '../src/theme';

const PRESETS = [
  { label: 'Emulator', url: 'http://10.0.2.2:8080' },
  { label: 'USB (adb reverse)', url: 'http://localhost:8080' },
];

export default function Settings() {
  const toast = useToast();
  const [url, setUrl] = useState(getBaseUrl());
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [deviceId, setDeviceId] = useState('');

  React.useEffect(() => {
    getDeviceId().then(setDeviceId).catch(() => {});
  }, []);

  const valid = /^https?:\/\/[^\s/]+/i.test(normalizeBaseUrl(url));

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      await testConnection(url);
      setResult({ ok: true, msg: 'Connected. The server is reachable.' });
    } catch {
      setResult({
        ok: false,
        msg: "Couldn't reach the server at this address. Check that the laptop backend is running and the phone is on the same network (or run adb reverse).",
      });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    const saved = await saveBaseUrl(url);
    setUrl(saved);
    toast('Server address saved.');
  };

  return (
    <Screen title="Settings" back testID="settings-screen">
      <Card>
        <Text style={[text.title, { marginBottom: spacing.sm }]}>Server address</Text>
        <Text style={[text.muted, { marginBottom: spacing.md }]}>
          The app talks to the league backend on the team laptop. Use 10.0.2.2:8080 on the emulator, or the laptop's
          network address on a phone.
        </Text>
        <Field
          label="Server URL"
          testID="settings-url"
          value={url}
          onChangeText={(v) => {
            setUrl(v);
            setResult(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder={DEFAULT_BASE_URL}
          error={valid ? null : 'Enter an address like http://192.168.1.10:8080'}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {PRESETS.map((p) => (
            <Chip key={p.url} testID={`settings-preset-${p.label.split(' ')[0]!.toLowerCase()}`} label={p.label} selected={normalizeBaseUrl(url) === p.url} onPress={() => setUrl(p.url)} />
          ))}
        </View>
        {result ? (
          result.ok ? (
            <InfoBanner tone="success" icon="checkmark-circle" message={result.msg} testID="settings-test-ok" />
          ) : (
            <ErrorBanner message={result.msg} testID="settings-test-error" />
          )
        ) : null}
        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          <SecondaryButton title="Test connection" icon="pulse" onPress={test} loading={testing} disabled={!valid} testID="settings-test" />
          <PrimaryButton title="Save address" icon="save-outline" onPress={save} disabled={!valid} testID="settings-save" />
        </View>
      </Card>
      <Card>
        <Text style={[text.title, { marginBottom: spacing.sm }]}>About this device</Text>
        <Text style={text.muted}>Device ID used for offline sync:</Text>
        <Text style={[text.body, { marginTop: 4 }]} selectable testID="settings-device-id">
          {deviceId || '…'}
        </Text>
      </Card>
    </Screen>
  );
}
