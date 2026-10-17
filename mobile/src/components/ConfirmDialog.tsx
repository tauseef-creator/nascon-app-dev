import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, text } from '../theme';
import { PrimaryButton, SecondaryButton } from './ui';

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmTitle = 'Confirm',
  cancelTitle = 'Cancel',
  destructive,
  loading,
  onConfirm,
  onCancel,
  children,
  testID = 'confirm-dialog',
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmTitle?: string;
  cancelTitle?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
  testID?: string;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.backdrop}>
        <View style={styles.box} testID={testID} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={{ padding: spacing.xl }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
              <Ionicons
                name={destructive ? 'warning' : 'help-circle'}
                size={28}
                color={destructive ? colors.danger : colors.info}
                accessibilityLabel={destructive ? 'Warning' : 'Question'}
              />
              <Text style={[text.title, { flex: 1 }]} accessibilityRole="header">
                {title}
              </Text>
            </View>
            {message ? <Text style={[text.body, { marginBottom: spacing.md }]}>{message}</Text> : null}
            {children}
            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              {destructive ? (
                <SecondaryButton title={confirmTitle} onPress={onConfirm} loading={loading} testID={`${testID}-confirm`} danger icon="warning" />
              ) : (
                <PrimaryButton title={confirmTitle} onPress={onConfirm} loading={loading} testID={`${testID}-confirm`} />
              )}
              <SecondaryButton title={cancelTitle} onPress={onCancel} disabled={loading} testID={`${testID}-cancel`} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(17,24,39,0.55)', justifyContent: 'center', padding: spacing.lg },
  box: { backgroundColor: colors.card, borderRadius: radius.lg, maxHeight: '90%', width: '100%', maxWidth: 520, alignSelf: 'center' },
});
