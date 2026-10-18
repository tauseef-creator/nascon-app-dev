// Dynamic QR code for a match / club / player / co-stream (FR-4.1). Reads
// GET /audit/v1/qr/{id}?inspect=true (does not count as a scan) and renders the SVG export,
// falling back to the PNG export. Exports open in the browser so they can be saved or printed.
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import React, { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { SvgUri } from 'react-native-svg';
import { api } from '../api/client';
import { errorText } from '../api/errors';
import { forDevice } from '../realtime/urls';
import { colors, radius, spacing, text } from '../theme';
import { useToast } from './Toast';
import { Card, ErrorBanner, LoadingView, SecondaryButton } from './ui';

export type QrInfo = {
  entity_id: string;
  entity_type?: string;
  entity_status?: string;
  short_url: string;
  target_route: string;
  deep_link_uri: string;
  scan_count?: number;
  export_formats: { svg: string; png: string; pdf: string };
};

export function QrCard({ entityId, title = 'Share with a QR code' }: { entityId: string; title?: string }) {
  const toast = useToast();
  const [info, setInfo] = useState<QrInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [svgFailed, setSvgFailed] = useState(false);
  const [missing, setMissing] = useState(false);
  const load = useCallback(async () => {
    setError(null);
    setMissing(false);
    try {
      setInfo(await api<QrInfo>(`/audit/v1/qr/${encodeURIComponent(entityId)}?inspect=true`, { auth: false }));
    } catch (e: any) {
      if (e?.code === 'QR_NOT_FOUND') setMissing(true);
      else setError(errorText(e));
    }
  }, [entityId]);
  useEffect(() => {
    load();
  }, [load]);

  const copy = async (value: string, what: string) => {
    await Clipboard.setStringAsync(value);
    toast(`${what} copied.`);
  };
  const open = (url: string | null) => {
    if (url) Linking.openURL(url).catch(() => toast('No app on this phone can open that file.', 'error'));
  };

  const svg = forDevice(info?.export_formats?.svg);
  const png = forDevice(info?.export_formats?.png);
  const pdf = forDevice(info?.export_formats?.pdf);
  const shortUrl = forDevice(info?.short_url) ?? '';

  return (
    <Card testID="qr-card">
      <Text style={[text.title, { marginBottom: spacing.sm }]} accessibilityRole="header">
        {title}
      </Text>
      {!info && !error && !missing ? <LoadingView label="Loading QR code…" /> : null}
      {missing ? (
        <Text style={text.muted} testID="qr-missing">
          There is no QR code for this yet.
        </Text>
      ) : null}
      {error && !info ? <ErrorBanner message={error} onRetry={load} testID="qr-error" /> : null}
      {info ? (
        <>
          <View style={styles.codeWrap} testID="qr-image" accessible accessibilityRole="image" accessibilityLabel={`QR code that opens ${info.short_url}`}>
            {svg && !svgFailed ? (
              <SvgUri uri={svg} width={208} height={208} onError={() => setSvgFailed(true)} />
            ) : png ? (
              <Image source={{ uri: png }} style={{ width: 208, height: 208 }} contentFit="contain" />
            ) : null}
          </View>
          <Text style={text.small}>Short link</Text>
          <Text style={[text.label, { marginBottom: spacing.xs }]} selectable testID="qr-short-url">
            {shortUrl}
          </Text>
          <Text style={text.small}>Opens in the app</Text>
          <Text style={[text.label, { marginBottom: spacing.xs }]} selectable testID="qr-deep-link">
            {info.deep_link_uri}
          </Text>
          <Text style={[text.small, { marginBottom: spacing.md }]} testID="qr-target">
            Without the app it opens the web player at {info.target_route}.
          </Text>
          <View style={styles.row}>
            <SecondaryButton compact title="Copy link" icon="copy-outline" onPress={() => copy(shortUrl, 'Link')} testID="qr-copy" style={styles.btn} />
            <SecondaryButton compact title="SVG" icon="document-text-outline" onPress={() => open(svg)} testID="qr-export-svg" accessibilityLabel="Open QR code as SVG" style={styles.btn} />
          </View>
          <View style={styles.row}>
            <SecondaryButton compact title="PNG" icon="document-text-outline" onPress={() => open(png)} testID="qr-export-png" accessibilityLabel="Open QR code as PNG" style={styles.btn} />
            <SecondaryButton compact title="PDF" icon="document-text-outline" onPress={() => open(pdf)} testID="qr-export-pdf" accessibilityLabel="Open QR code as a printable PDF" style={styles.btn} />
          </View>
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  codeWrap: { alignSelf: 'center', padding: spacing.md, backgroundColor: colors.white, borderRadius: radius.md, marginBottom: spacing.md, minWidth: 232, minHeight: 232, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  btn: { flex: 1 },
});
