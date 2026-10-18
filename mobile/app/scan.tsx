// Native QR scanner (FR-4.1). Scans with expo-camera and opens NaSCon links inside the app:
// nascon://entity/{id}, nascon://stream/{id}, and short links http://<server>/q/{code}, which are
// resolved through the server's 302 redirect to the matching Guest Web Player route.
import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../src/components/Screen';
import { Card, ErrorBanner, Field, InfoBanner, PrimaryButton, SecondaryButton } from '../src/components/ui';
import { forDevice, isShortLink, routeForLink } from '../src/realtime/urls';
import { colors, radius, spacing, text } from '../src/theme';

async function resolveShortLink(url: string): Promise<string> {
  const res = await fetch(forDevice(url) ?? url, { method: 'GET', headers: { Accept: 'text/html,application/json' } });
  return res.url || url;
}

export default function Scan() {
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [foreign, setForeign] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const locked = useRef(false);
  // The scan screen stays mounted under the screen it opened; ignore codes while it is not focused
  // so a QR code still in view does not open the same screen again.
  const focused = useRef(true);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
      };
    }, []),
  );

  const handle = useCallback(async (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    setMessage(null);
    setForeign(null);
    let target = routeForLink(value);
    let unreachable = false;
    if (!target && isShortLink(value)) {
      setWorking(true);
      try {
        target = routeForLink(await resolveShortLink(value));
      } catch {
        unreachable = true;
      } finally {
        setWorking(false);
      }
    }
    if (target) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.push(target.pathname as any);
      setTimeout(() => (locked.current = false), 1500);
      return;
    }
    setMessage(
      unreachable
        ? "We couldn't reach the server to open this code. Check your connection and try again."
        : 'This QR code is not a NaSCon match, club, athlete or co-stream link.',
    );
    if (/^https?:\/\//i.test(value)) setForeign(value);
    setTimeout(() => (locked.current = false), 2500);
  }, []);

  const onScanned = (r: BarcodeScanningResult) => {
    if (locked.current || !focused.current) return;
    locked.current = true;
    handle(r.data);
  };

  return (
    <Screen title="Scan a QR code" back testID="scan-screen">
      {!permission ? null : permission.granted ? (
        <View style={styles.cameraWrap} testID="scan-camera" accessible accessibilityLabel="Camera viewfinder. Point it at a NaSCon QR code.">
          <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScanned} />
          <View pointerEvents="none" style={styles.frame} />
        </View>
      ) : (
        <Card testID="scan-permission">
          <Text style={[text.body, { marginBottom: spacing.md }]}>
            {permission.canAskAgain
              ? 'The app needs the camera to scan QR codes. Nothing is recorded or uploaded.'
              : 'Camera access is turned off for this app. Turn it on in Android settings, or type the link below.'}
          </Text>
          {permission.canAskAgain ? (
            <PrimaryButton title="Allow camera" icon="videocam" onPress={requestPermission} testID="scan-allow" />
          ) : (
            <SecondaryButton title="Open settings" icon="settings-outline" onPress={() => Linking.openSettings().catch(() => {})} testID="scan-settings" />
          )}
        </Card>
      )}
      {working ? <InfoBanner message="Opening link…" testID="scan-working" /> : null}
      {message ? <ErrorBanner message={message} testID="scan-error" /> : null}
      {foreign ? <SecondaryButton title="Open in browser" icon="arrow-forward" onPress={() => Linking.openURL(foreign).catch(() => setMessage('No app on this phone can open that link.'))} testID="scan-open-browser" /> : null}

      <Text style={[text.small, { marginTop: spacing.lg, marginBottom: spacing.sm }]}>Can't scan? Type or paste the link instead.</Text>
      <Field
        label="Link"
        testID="scan-manual"
        value={manual}
        onChangeText={setManual}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="nascon://entity/match-m1"
        keyboardType="url"
      />
      <PrimaryButton title="Open link" onPress={() => handle(manual)} disabled={!manual.trim() || working} testID="scan-manual-open" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  cameraWrap: { width: '100%', aspectRatio: 1, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000', marginBottom: spacing.md, alignItems: 'center', justifyContent: 'center' },
  frame: { width: '64%', aspectRatio: 1, borderRadius: radius.md, borderWidth: 3, borderColor: colors.accent },
});
