import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';
import { requestPasswordReset, resetPasswordWithCode } from '../services/SecureAuthService';

const MIN_PASSWORD_LENGTH = 6;
const STEP = { EMAIL: 'email', CODE: 'code' };

/**
 * Two-step password reset: email → emailed one-time code + new password.
 * Errors render inline (an app alert cannot stack on top of this Modal on iOS).
 * On success the user is signed in; `onSuccess` should load their profile.
 */
export default function ForgotPasswordModal({ visible, initialEmail, onClose, onSuccess }) {
  const [step, setStep] = useState(STEP.EMAIL);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (!visible) return;
    setStep(STEP.EMAIL);
    setEmail(initialEmail?.trim() || '');
    setCode('');
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setError(null);
    setNotice(null);
  }, [visible, initialEmail]);

  const handleSendCode = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email);
      setStep(STEP.CODE);
      setNotice(`If an account exists for ${email.trim()}, we've emailed it a reset code.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    if (busy) return;
    if (!/^\d{6,10}$/.test(code.trim())) {
      setError('Enter the code from the email.');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resetPasswordWithCode(email, code, password);
      await onSuccess?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const isEmailStep = step === STEP.EMAIL;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={busy ? undefined : onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Reset password</Text>
            <TouchableOpacity
              onPress={onClose}
              disabled={busy}
              style={styles.closeBtn}
              accessibilityLabel="Close"
              accessibilityRole="button"
            >
              <MaterialCommunityIcons name="close" size={22} color={COLORS.darkGrey} />
            </TouchableOpacity>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            <Text style={styles.hint}>
              {isEmailStep
                ? "Enter your account email and we'll send you a reset code."
                : notice}
            </Text>

            {isEmailStep ? (
              <View style={styles.inputRow}>
                <MaterialCommunityIcons name="email-outline" size={18} color={COLORS.mediumGrey} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Email"
                  placeholderTextColor={COLORS.mediumGrey}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  editable={!busy}
                />
              </View>
            ) : (
              <>
                <View style={styles.inputRow}>
                  <MaterialCommunityIcons name="numeric" size={18} color={COLORS.mediumGrey} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Code from email"
                    placeholderTextColor={COLORS.mediumGrey}
                    value={code}
                    onChangeText={setCode}
                    keyboardType="number-pad"
                    autoComplete="one-time-code"
                    textContentType="oneTimeCode"
                    maxLength={10}
                    editable={!busy}
                  />
                </View>
                <View style={styles.inputRow}>
                  <MaterialCommunityIcons name="lock-outline" size={18} color={COLORS.mediumGrey} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="New password"
                    placeholderTextColor={COLORS.mediumGrey}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    autoComplete="password-new"
                    textContentType="newPassword"
                    editable={!busy}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword((v) => !v)}
                    style={styles.eyeBtn}
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <MaterialCommunityIcons
                      name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={18}
                      color={COLORS.mediumGrey}
                    />
                  </TouchableOpacity>
                </View>
                <View style={styles.inputRow}>
                  <MaterialCommunityIcons name="lock-check-outline" size={18} color={COLORS.mediumGrey} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Confirm new password"
                    placeholderTextColor={COLORS.mediumGrey}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry={!showPassword}
                    autoComplete="password-new"
                    textContentType="newPassword"
                    editable={!busy}
                  />
                </View>
              </>
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.primaryBtn, busy && styles.btnDisabled]}
              onPress={isEmailStep ? handleSendCode : handleReset}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <Text style={styles.primaryBtnText}>
                  {isEmailStep ? 'Send code' : 'Set new password'}
                </Text>
              )}
            </TouchableOpacity>

            {!isEmailStep ? (
              <TouchableOpacity onPress={handleSendCode} disabled={busy} style={styles.linkBtn}>
                <Text style={styles.linkText}>Send a new code</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.darkGrey,
  },
  closeBtn: {
    padding: 4,
  },
  body: {
    padding: 20,
    gap: 12,
  },
  hint: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.mediumGrey,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 10,
    paddingHorizontal: 14,
    height: 50,
    borderWidth: 1,
    borderColor: COLORS.divider,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: COLORS.darkGrey,
  },
  eyeBtn: {
    padding: 4,
    marginLeft: 6,
  },
  error: {
    fontSize: 14,
    color: COLORS.errorRed,
  },
  primaryBtn: {
    backgroundColor: COLORS.amber,
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  btnDisabled: {
    opacity: 0.55,
  },
  primaryBtnText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  linkBtn: {
    alignSelf: 'center',
    padding: 6,
  },
  linkText: {
    color: COLORS.amber,
    fontWeight: '700',
    fontSize: 14,
  },
});
