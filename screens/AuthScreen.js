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
} from '../services/SecureAuthService';
import PintGlassIcon from '../components/PintGlassIcon';
import { APP_DISPLAY_NAME } from '../constants/app';
import { COLORS } from '../constants/theme';
import { isSupabaseConfigured, getSupabaseProjectHost } from '../config/supabase';
import { useAppAlert } from '../contexts/AppAlertContext';

function authNetworkErrorMessage() {
  if (!isSupabaseConfigured) {
    return (
      'This build cannot reach Supabase. In expo.dev → your project → Environment variables, ' +
      'set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY for the production ' +
      'environment (from Supabase → Project Settings → API), then create a new build.'
    );
  }
  const host = getSupabaseProjectHost();
  return (
    `Cannot reach Supabase${host ? ` (${host})` : ''}. Check your internet connection, ` +
    'confirm the Supabase project is active (not paused), and rebuild if you recently changed env vars.'
  );
}

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

  const switchMode = () => {
    setIsLogin(!isLogin);
    clearForm();
  };

  const handleAuth = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      showAppAlert({ title: 'Error', message: 'Please enter your email', tone: 'error' });
      return;
    }
    if (!validateEmail(trimmedEmail)) {
      showAppAlert({
        title: 'Error',
        message: 'Please enter a valid email address',
        tone: 'error',
      });
      return;
    }
    if (!password) {
      showAppAlert({ title: 'Error', message: 'Please enter a password', tone: 'error' });
      return;
    }

    if (!isLogin) {
      if (password.length < 6) {
        showAppAlert({
          title: 'Error',
          message: 'Password must be at least 6 characters',
          tone: 'error',
        });
        return;
      }
      if (password !== confirmPassword) {
        showAppAlert({ title: 'Error', message: 'Passwords do not match', tone: 'error' });
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
          showAppAlert({
            title: 'Check Your Email',
            message: `We sent a verification link to ${trimmedEmail}.\n\nClick the link then come back and log in.`,
            tone: 'neutral',
            buttons: [
              {
                text: 'OK',
                variant: 'primary',
                onPress: () => {
                  setIsLogin(true);
                  clearForm();
                },
              },
            ],
          });
          return;
        }
        showAppAlert({ title: 'Success', message: 'Account created!', tone: 'success' });
        await onAuthSuccess();
      }
    } catch (error) {
      const msg = error.message || 'Something went wrong';
      if (msg.includes('already registered') || msg.includes('login tab instead')) {
        showAppAlert({
          title: 'Already Registered',
          message: msg,
          tone: 'error',
          buttons: [
            {
              text: 'Switch to Login',
              variant: 'primary',
              onPress: () => {
                setIsLogin(true);
                clearForm();
              },
            },
          ],
        });
      } else if (msg.includes('Too many') || msg.includes('rate limit') || msg.includes('wait')) {
        showAppAlert({ title: 'Please Wait', message: msg, tone: 'neutral' });
      } else if (msg.includes('Invalid email or password')) {
        showAppAlert({ title: 'Error', message: 'Invalid email or password.', tone: 'error' });
      } else if (msg.includes('valid email')) {
        showAppAlert({ title: 'Error', message: msg, tone: 'error' });
      } else if (msg.includes('Email not confirmed') || msg.includes('not confirmed')) {
        showAppAlert({
          title: 'Email Not Verified',
          message:
            'Please verify your email before logging in.\n\nCheck your inbox for the verification link.',
          tone: 'neutral',
        });
      } else if (/network request failed|failed to fetch|network error/i.test(msg)) {
        showAppAlert({
          title: 'Connection problem',
          message: authNetworkErrorMessage(),
          tone: 'neutral',
        });
      } else {
        console.error('Auth error:', error);
        showAppAlert({ title: 'Error', message: msg, tone: 'error' });
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
      if (/network request failed|failed to fetch|network error/i.test(msg)) {
        showAppAlert({
          title: 'Connection problem',
          message: authNetworkErrorMessage(),
          tone: 'neutral',
        });
      } else {
        showAppAlert({
          title: 'Error',
          message: 'Sign in with Apple failed. Please try again.',
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
          title: 'Error',
          message: 'Google Play Services is not available on this device.',
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
        showAppAlert({
          title: 'Google Sign-In setup',
          message:
            'This build’s signing key is not registered in Google Cloud.\n\n' +
            '1. Run: npx @react-native-google-signin/config-doctor\n' +
            '2. Or in Google Cloud → Credentials → Android OAuth client:\n' +
            '   • Package: com.fintanlyons.pubtracker (or your EXPO_PUBLIC_ANDROID_PACKAGE)\n' +
            '   • SHA-1: from `eas credentials -p android` for the profile you installed\n' +
            '3. webClientId must be the Web client ID (not Android).\n' +
            '4. Rebuild the APK after updating credentials.',
          tone: 'error',
        });
        return;
      }

      console.error('Google Sign-In error — code:', code, '| message:', msg, '| raw:', error);

      if (/network request failed|failed to fetch|network error/i.test(msg)) {
        showAppAlert({
          title: 'Connection problem',
          message: authNetworkErrorMessage(),
          tone: 'neutral',
        });
      } else {
        showAppAlert({
          title: 'Sign-in failed',
          message: `Google Sign-In failed. Please try again.\n\n(${code || msg || 'unknown error'})`,
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
                <Text style={[styles.tabText, isLogin && styles.activeTabText]}>Sign In</Text>
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
                  : <Text style={styles.primaryBtnText}>{isLogin ? 'Sign In' : 'Create Account'}</Text>
                }
              </TouchableOpacity>

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

            <TouchableOpacity style={styles.switchRow} onPress={switchMode}>
              <Text style={styles.switchText}>
                {isLogin ? "Don't have an account? " : 'Already have an account? '}
                <Text style={styles.switchLink}>{isLogin ? 'Register' : 'Sign in'}</Text>
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
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

  switchRow: {
    alignItems: 'center',
    marginTop: 28,
  },
  switchText: {
    fontSize: 14,
    color: COLORS.mediumGrey,
  },
  switchLink: {
    color: COLORS.amber,
    fontWeight: '700',
  },
});
