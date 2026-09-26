import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import {
  registerUserSecure,
  loginUserSecure,
  googleSignInSecure,
  appleSignInSecure,
  resendConfirmationEmail,
  CONFIRMATION_RESEND_COOLDOWN_SECONDS,
} from '../services/SecureAuthService';
import PintGlassIcon from '../components/PintGlassIcon';
import { APP_DISPLAY_NAME } from '../constants/app';
import { COLORS } from '../constants/theme';
import { isSupabaseConfigured } from '../config/supabase';
import { CONNECTION_ERROR_MESSAGE } from '../services/authErrors';
import ForgotPasswordModal from '../components/ForgotPasswordModal';
import { useAppAlert } from '../contexts/AppAlertContext';

/** Developer setup message — only shown in builds missing the Supabase env vars. */
const MISSING_CONFIG_MESSAGE =
  'This build cannot reach Supabase. Set EXPO_PUBLIC_SUPABASE_URL and ' +
  'EXPO_PUBLIC_SUPABASE_ANON_KEY for this EAS environment, then create a new build.';

function authNetworkErrorMessage() {
  return isSupabaseConfigured ? CONNECTION_ERROR_MESSAGE : MISSING_CONFIG_MESSAGE;
}

const isConnectionErrorMessage = (msg) =>
  msg === CONNECTION_ERROR_MESSAGE || /network request failed|failed to fetch|network error/i.test(msg);

export default function AuthScreen({ onAuthSuccess }) {
  const { showAppAlert } = useAppAlert();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [appleAuthAvailable, setAppleAuthAvailable] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  /** Email awaiting confirmation: { email, availableAt } — drives the resend panel. */
  const [pendingConfirmation, setPendingConfirmation] = useState(null);
  const [resendBusy, setResendBusy] = useState(false);
  /** { text, tone: 'success' | 'error' } shown inside the resend panel. */
  const [resendNote, setResendNote] = useState(null);
  const [now, setNow] = useState(Date.now());

  // Tick once a second while the resend cooldown is running.
  useEffect(() => {
    if (!pendingConfirmation || pendingConfirmation.availableAt <= now) return undefined;
    const t = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(t);
  }, [pendingConfirmation, now]);

  useEffect(() => {
    let cancelled = false;
    if (Platform.OS !== 'ios') return undefined;
    (async () => {
      try {
        const ok = await AppleAuthentication.isAvailableAsync();
        if (!cancelled) setAppleAuthAvailable(ok);
      } catch {
        if (!cancelled) setAppleAuthAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const validateEmail = (text) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);

  const clearForm = () => {
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirmPassword(false);
  };

  const SPAM_TIP = "Can't find it? Check your spam or junk folder.";

  const awaitConfirmation = (targetEmail, cooldownSeconds) => {
    setPendingConfirmation({ email: targetEmail, availableAt: Date.now() + cooldownSeconds * 1000 });
    setResendNote(null);
    setNow(Date.now());
  };

  const handleResendConfirmation = async () => {
    if (!pendingConfirmation || resendBusy) return;
    const targetEmail = pendingConfirmation.email;
    setResendBusy(true);
    setResendNote(null);
    try {
      await resendConfirmationEmail(targetEmail);
      awaitConfirmation(targetEmail, CONFIRMATION_RESEND_COOLDOWN_SECONDS);
      setResendNote({ text: 'Sent again — check your inbox and spam folder.', tone: 'success' });
    } catch (e) {
      if (e.retryAfterSeconds) awaitConfirmation(targetEmail, e.retryAfterSeconds);
      setResendNote({ text: e.message, tone: 'error' });
    } finally {
      setResendBusy(false);
    }
  };

  const handleAuth = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      showAppAlert({ title: 'Email needed', message: 'Enter your email address.', tone: 'error' });
      return;
    }
    if (!validateEmail(trimmedEmail)) {
      showAppAlert({
        title: 'Check your email address',
        message: "That doesn't look like a valid email address.",
        tone: 'error',
      });
      return;
    }
    if (!password) {
      showAppAlert({ title: 'Password needed', message: 'Enter your password.', tone: 'error' });
      return;
    }

    if (!isLogin) {
      if (password.length < 6) {
        showAppAlert({
          title: 'Password too short',
          message: 'Use at least 6 characters.',
          tone: 'error',
        });
        return;
      }
      if (password !== confirmPassword) {
        showAppAlert({
          title: "Passwords don't match",
          message: 'Re-enter the same password in both fields.',
          tone: 'error',
        });
        return;
      }
    }

    try {
      setLoading(true);
      if (isLogin) {
        await loginUserSecure(trimmedEmail, password);
        await onAuthSuccess();
      } else {
        const { needsEmailVerification } = await registerUserSecure(trimmedEmail, password);
        if (needsEmailVerification) {
          awaitConfirmation(trimmedEmail, CONFIRMATION_RESEND_COOLDOWN_SECONDS);
          setIsLogin(true);
          clearForm();
          showAppAlert({
            title: 'Check your email',
            message: `We've sent a confirmation link to ${trimmedEmail}. Tap it, then come back and sign in.\n\n${SPAM_TIP}`,
            tone: 'neutral',
          });
          return;
        }
        await onAuthSuccess();
      }
    } catch (error) {
      const msg = error.message || '';
      if (msg.includes('already registered') || msg.includes('login tab instead')) {
        showAppAlert({
          title: 'Already registered',
          message: 'An account with this email already exists. Sign in instead.',
          tone: 'error',
          buttons: [
            {
              text: 'Sign in',
              variant: 'primary',
              onPress: () => {
                setIsLogin(true);
                clearForm();
              },
            },
          ],
        });
      } else if (msg.includes('Too many') || msg.includes('rate limit') || msg.includes('wait')) {
        showAppAlert({ title: 'Too many attempts', message: msg, tone: 'neutral' });
      } else if (msg.includes('Invalid email or password')) {
        showAppAlert({
          title: 'Wrong email or password',
          message: 'Check them and try again, or tap "Forgot password?".',
          tone: 'error',
        });
      } else if (msg.includes('valid email')) {
        showAppAlert({ title: 'Check your email address', message: msg, tone: 'error' });
      } else if (msg.includes('not confirmed')) {
        // Keep an existing cooldown for this address; otherwise allow an immediate resend.
        if (pendingConfirmation?.email !== trimmedEmail) awaitConfirmation(trimmedEmail, 0);
        showAppAlert({
          title: 'Confirm your email first',
          message: `Tap the confirmation link we sent to ${trimmedEmail}, then sign in. You can resend it below.`,
          tone: 'neutral',
        });
      } else if (isConnectionErrorMessage(msg)) {
        showAppAlert({
          title: 'Connection problem',
          message: authNetworkErrorMessage(),
          tone: 'neutral',
        });
      } else {
        console.error('Auth error:', error);
        showAppAlert({
          title: isLogin ? "Couldn't sign in" : "Couldn't create your account",
          message: msg || 'Something went wrong. Please try again.',
          tone: 'error',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    if (appleLoading || loading || googleLoading) return;
    try {
      setAppleLoading(true);
      await appleSignInSecure();
      await onAuthSuccess();
    } catch (error) {
      const msg = error.message || '';
      if (
        msg.includes('ERR_REQUEST_CANCELED') ||
        error?.code === 'ERR_REQUEST_CANCELED'
      ) {
        return;
      }
      console.error('Apple Sign-In error:', error);
      if (isConnectionErrorMessage(msg)) {
        showAppAlert({
          title: 'Connection problem',
          message: authNetworkErrorMessage(),
          tone: 'neutral',
        });
      } else {
        showAppAlert({
          title: "Couldn't sign in with Apple",
          message: 'Please try again, or sign in with your email.',
          tone: 'error',
        });
      }
    } finally {
      setAppleLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setGoogleLoading(true);
      await googleSignInSecure();
      await onAuthSuccess();
    } catch (error) {
      const msg = error.message || '';
      const code = error.code || '';

      // User dismissed the account picker — not an error.
      if (
        code === 'SIGN_IN_CANCELLED' ||
        msg.includes('SIGN_IN_CANCELLED') ||
        msg.includes('canceled') ||
        msg.includes('cancelled')
      ) {
        return;
      }

      if (
        code === 'PLAY_SERVICES_NOT_AVAILABLE' ||
        msg.includes('PLAY_SERVICES_NOT_AVAILABLE')
      ) {
        showAppAlert({
          title: 'Google sign-in unavailable',
          message: "This device doesn't have Google Play Services. Sign in with your email instead.",
          tone: 'error',
        });
        return;
      }

      // Android OAuth client / SHA-1 mismatch (Google Cloud Console).
      if (
        code === 10 ||
        code === '10' ||
        msg.includes('DEVELOPER_ERROR') ||
        msg.includes('Developer console is not set up correctly')
      ) {
        // Build signing key not registered in Google Cloud (see `npx @react-native-google-signin/config-doctor`).
        console.error('Google Sign-In DEVELOPER_ERROR — check Android OAuth client SHA-1 / webClientId', { code, msg });
        showAppAlert({
          title: 'Google sign-in unavailable',
          message: "Google sign-in isn't working in this version of the app. Please sign in with your email.",
          tone: 'error',
        });
        return;
      }

      console.error('Google Sign-In error — code:', code, '| message:', msg, '| raw:', error);

      if (isConnectionErrorMessage(msg)) {
        showAppAlert({
          title: 'Connection problem',
          message: authNetworkErrorMessage(),
          tone: 'neutral',
        });
      } else {
        showAppAlert({
          title: "Couldn't sign in with Google",
          message: 'Please try again, or sign in with your email.',
          tone: 'error',
        });
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.header}>
              <PintGlassIcon size={56} color={COLORS.amber} />
              <Text style={styles.title}>{APP_DISPLAY_NAME}</Text>
              <Text style={styles.subtitle}>London's pub community</Text>
            </View>

            {!isSupabaseConfigured ? (
              <View style={styles.configBanner}>
                <Text style={styles.configBannerTitle}>Server not configured</Text>
                <Text style={styles.configBannerBody}>{authNetworkErrorMessage()}</Text>
              </View>
            ) : null}

            <View style={styles.tabContainer}>
              <TouchableOpacity
                style={[styles.tab, isLogin && styles.activeTab]}
                onPress={() => { setIsLogin(true); clearForm(); }}
              >
                <Text style={[styles.tabText, isLogin && styles.activeTabText]}>Sign in</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tab, !isLogin && styles.activeTab]}
                onPress={() => setIsLogin(false)}
              >
                <Text style={[styles.tabText, !isLogin && styles.activeTabText]}>Register</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.form}>
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
                />
              </View>

              <View style={styles.inputRow}>
                <MaterialCommunityIcons name="lock-outline" size={18} color={COLORS.mediumGrey} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor={COLORS.mediumGrey}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoComplete="password"
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                  <MaterialCommunityIcons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color={COLORS.mediumGrey}
                  />
                </TouchableOpacity>
              </View>

              {isLogin && (
                <TouchableOpacity
                  onPress={() => setShowForgotPassword(true)}
                  style={styles.forgotRow}
                  accessibilityRole="button"
                >
                  <Text style={styles.switchLink}>Forgot password?</Text>
                </TouchableOpacity>
              )}

              {!isLogin && (
                <View style={styles.inputRow}>
                  <MaterialCommunityIcons name="lock-check-outline" size={18} color={COLORS.mediumGrey} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Confirm password"
                    placeholderTextColor={COLORS.mediumGrey}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry={!showConfirmPassword}
                    autoComplete="password"
                  />
                  <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)} style={styles.eyeBtn}>
                    <MaterialCommunityIcons
                      name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={18}
                      color={COLORS.mediumGrey}
                    />
                  </TouchableOpacity>
                </View>
              )}

              <TouchableOpacity
                style={[styles.primaryBtn, loading && styles.btnDisabled]}
                onPress={handleAuth}
                disabled={loading || googleLoading || appleLoading}
              >
                {loading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.primaryBtnText}>{isLogin ? 'Sign in' : 'Create account'}</Text>
                }
              </TouchableOpacity>

              {pendingConfirmation ? (
                <View style={styles.confirmPanel}>
                  <Text style={styles.confirmTitle}>
                    Waiting for you to confirm {pendingConfirmation.email}
                  </Text>
                  <Text style={styles.confirmHint}>{SPAM_TIP}</Text>
                  {(() => {
                    const secondsLeft = Math.ceil((pendingConfirmation.availableAt - now) / 1000);
                    const coolingDown = secondsLeft > 0;
                    return (
                      <TouchableOpacity
                        style={[styles.confirmResendBtn, (coolingDown || resendBusy) && styles.btnDisabled]}
                        onPress={handleResendConfirmation}
                        disabled={coolingDown || resendBusy}
                        accessibilityRole="button"
                      >
                        {resendBusy ? (
                          <ActivityIndicator size="small" color={COLORS.amber} />
                        ) : (
                          <Text style={styles.confirmResendText}>
                            {coolingDown ? `Resend email in ${secondsLeft}s` : 'Resend email'}
                          </Text>
                        )}
                      </TouchableOpacity>
                    );
                  })()}
                  {resendNote ? (
                    <Text style={resendNote.tone === 'error' ? styles.confirmNoteError : styles.confirmNoteSuccess}>
                      {resendNote.text}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>

              {Platform.OS === 'ios' && appleAuthAvailable ? (
                <View style={styles.appleBtnWrap}>
                  <AppleAuthentication.AppleAuthenticationButton
                    buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                    buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                    cornerRadius={10}
                    style={styles.appleBtn}
                    onPress={handleAppleSignIn}
                  />
                  {appleLoading ? (
                    <View style={styles.appleBtnOverlay} pointerEvents="auto">
                      <ActivityIndicator size="small" color={COLORS.darkGrey} />
                    </View>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.googleBtnWrap}>
                <TouchableOpacity
                  style={[styles.googleBtn, (loading || googleLoading || appleLoading) && styles.btnDisabled]}
                  onPress={handleGoogleSignIn}
                  disabled={loading || googleLoading || appleLoading}
                >
                  <View style={styles.googleBtnContent}>
                    <View style={styles.googleLogoWrap}>
                      <Image
                        source={require('../assets/google_logo.png')}
                        style={styles.googleLogo}
                        resizeMode="cover"
                      />
                    </View>
                    <Text style={styles.googleBtnText}>Sign in with Google</Text>
                  </View>
                </TouchableOpacity>
                {googleLoading ? (
                  <View style={styles.googleBtnOverlay} pointerEvents="auto">
                    <ActivityIndicator size="small" color={COLORS.darkGrey} />
                  </View>
                ) : null}
              </View>
            </View>

          </ScrollView>
        </KeyboardAvoidingView>
        <ForgotPasswordModal
          visible={showForgotPassword}
          initialEmail={email}
          onClose={() => setShowForgotPassword(false)}
          onSuccess={onAuthSuccess}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F7F7',
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 32,
  },

  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  configBanner: {
    backgroundColor: COLORS.errorLight,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: COLORS.errorRed,
  },
  configBannerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.errorRed,
    marginBottom: 8,
  },
  configBannerBody: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.darkGrey,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.darkGrey,
    marginTop: 12,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.mediumGrey,
    marginTop: 4,
  },

  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#E5E5E5',
    borderRadius: 10,
    padding: 3,
    marginBottom: 24,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.mediumGrey,
  },
  activeTabText: {
    color: COLORS.darkGrey,
  },

  form: {
    gap: 12,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 14,
    height: 50,
    borderWidth: 1,
    borderColor: '#E8E8E8',
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

  primaryBtn: {
    backgroundColor: COLORS.amber,
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 4,
    shadowColor: COLORS.amber,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  btnDisabled: {
    opacity: 0.55,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E0E0E0',
  },
  dividerText: {
    marginHorizontal: 12,
    fontSize: 12,
    color: COLORS.mediumGrey,
    fontWeight: '500',
  },

  appleBtnWrap: {
    position: 'relative',
    width: '100%',
    minHeight: 50,
  },
  appleBtn: {
    width: '100%',
    height: 50,
  },
  appleBtnOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
    borderRadius: 10,
  },

  googleBtnWrap: {
    position: 'relative',
    width: '100%',
    minHeight: 50,
  },
  googleBtn: {
    width: '100%',
    height: 50,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
  },
  googleBtnContent: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  googleLogoWrap: {
    width: 20,
    height: 20,
    overflow: 'hidden',
    borderRadius: 2,
  },
  googleLogo: {
    width: 28,
    height: 28,
    marginLeft: -4,
    marginTop: -4,
  },
  googleBtnText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.darkGrey,
  },
  googleBtnOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
    borderRadius: 10,
  },

  forgotRow: {
    alignSelf: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  confirmPanel: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.divider,
    padding: 14,
    gap: 6,
  },
  confirmTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.darkGrey,
  },
  confirmHint: {
    fontSize: 13,
    color: COLORS.mediumGrey,
  },
  confirmResendBtn: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.amber,
    minWidth: 150,
    alignItems: 'center',
  },
  confirmResendText: {
    color: COLORS.amber,
    fontWeight: '700',
    fontSize: 14,
  },
  confirmNoteSuccess: {
    fontSize: 13,
    color: COLORS.successGreen,
  },
  confirmNoteError: {
    fontSize: 13,
    color: COLORS.errorRed,
  },
  switchLink: {
    color: COLORS.amber,
    fontWeight: '700',
  },
});
