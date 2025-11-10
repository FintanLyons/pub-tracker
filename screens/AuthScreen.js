import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { registerUserSecure, loginUserSecure } from '../services/SecureAuthService';
import PintGlassIcon from '../components/PintGlassIcon';

const DARK_GREY = '#2C2C2C';
const LIGHT_GREY = '#F5F5F5';
const MEDIUM_GREY = '#757575';
const AMBER = '#D4A017';

export default function AuthScreen({ onAuthSuccess }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validateUsername = (username) => {
    // Username must be 3-20 characters, alphanumeric and underscores only
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    return usernameRegex.test(username);
  };

  const handleAuth = async () => {
    // Validation
    if (!username.trim()) {
      Alert.alert('Error', 'Please enter a username');
      return;
    }

    if (!validateUsername(username)) {
      Alert.alert(
        'Invalid Username',
        'Username must be 3-20 characters and contain only letters, numbers, and underscores'
      );
      return;
    }

    if (!isLogin) {
      if (!email.trim()) {
        Alert.alert('Error', 'Please enter an email');
        return;
      }

      if (!validateEmail(email)) {
        Alert.alert('Error', 'Please enter a valid email address');
        return;
      }

      if (!password) {
        Alert.alert('Error', 'Please enter a password');
        return;
      }

      if (password.length < 6) {
        Alert.alert('Error', 'Password must be at least 6 characters');
        return;
      }

      if (password !== confirmPassword) {
        Alert.alert('Error', 'Passwords do not match');
        return;
      }
    }

    if (!password) {
      Alert.alert('Error', 'Please enter a password');
      return;
    }

    try {
      setLoading(true);

      if (isLogin) {
        // For login, we need email not username
        // Try to find email by username first
        const { user, session } = await loginUserSecure(email || username, password);
        
        // Check if email is verified
        if (session?.user?.email_confirmed_at) {
          Alert.alert('Success', 'Welcome back!');
        } else {
          Alert.alert(
            'Email Not Verified',
            'Please check your email and click the verification link. You can still use the app, but some features may be limited.',
            [{ text: 'OK' }]
          );
        }
      } else {
        const { user, session, needsEmailVerification } = await registerUserSecure(
          email,
          username,
          password
        );
        
        if (needsEmailVerification) {
          Alert.alert(
            '📧 Confirm Your Email',
            'We sent a verification link to ' + email + '.\n\nPlease check your inbox and click the link to verify your email.\n\nOnce verified, come back here and login with your username and password.',
            [
              {
                text: 'OK',
                onPress: () => {
                  // Switch to login tab
                  setIsLogin(true);
                  setPassword('');
                  setConfirmPassword('');
                }
              }
            ]
          );
          // Don't call onAuthSuccess - user needs to verify first
          return;
        } else {
          Alert.alert('Success', 'Account created! You can now compete with friends.');
        }
      }

      onAuthSuccess();
    } catch (error) {
      let errorMessage = error.message;
      let alertTitle = 'Error';
      let shouldSwitchToLogin = false;
      let isExpectedError = false; // Track if this is a user-facing validation error
      
      if (errorMessage.includes('Username already taken')) {
        errorMessage = 'This username is already taken. Please choose another.';
        isExpectedError = true;
      } else if (errorMessage.includes('already registered') || errorMessage.includes('login tab instead')) {
        alertTitle = '❌ Already Registered';
        errorMessage = 'This email is already registered.\n\nPlease switch to the LOGIN tab and sign in with your username and password.';
        shouldSwitchToLogin = true;
        isExpectedError = true;
      } else if (errorMessage.includes('Too many attempts') || errorMessage.includes('rate limit') || errorMessage.includes('wait')) {
        alertTitle = '⏱️ Please Wait';
        errorMessage = 'Too many attempts. Please wait 1 minute before trying again.';
        isExpectedError = true;
      } else if (errorMessage.includes('User not found') || errorMessage.includes('Invalid login')) {
        errorMessage = 'Invalid username/email or password. Please try again.';
        isExpectedError = true;
      } else if (errorMessage.includes('Supabase not configured')) {
        errorMessage = 'Server configuration error. Please contact support.';
        isExpectedError = false; // This is a system error
      } else if (errorMessage.includes('Email not confirmed') || errorMessage.includes('not confirmed')) {
        alertTitle = '📧 Email Not Verified';
        errorMessage = 'Please verify your email before logging in.\n\nCheck your inbox for the verification link, click it, then try logging in again.';
        isExpectedError = true;
      } else if (errorMessage.includes('Invalid email or password')) {
        errorMessage = 'Invalid credentials. If you just registered, please verify your email first.';
        isExpectedError = true;
      }
      
      // Only log unexpected system errors, not user-facing validation errors
      if (!isExpectedError) {
        console.error('Auth error:', error);
      }
      
      if (shouldSwitchToLogin) {
        Alert.alert(
          alertTitle,
          errorMessage,
          [
            {
              text: 'Switch to Login',
              onPress: () => {
                setIsLogin(true);
                setPassword('');
                setConfirmPassword('');
              }
            }
          ]
        );
      } else {
        Alert.alert(alertTitle, errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setIsLogin(!isLogin);
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirmPassword(false);
  };

  return (
    <SafeAreaProvider>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <PintGlassIcon size={64} color={AMBER} />
            <Text style={styles.title}>Pub Tracker</Text>
            <Text style={styles.subtitle}>
              {isLogin ? 'Welcome Back!' : 'Join the Community'}
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.tabContainer}>
              <TouchableOpacity
                style={[styles.tab, isLogin && styles.activeTab]}
                onPress={() => setIsLogin(true)}
              >
                <Text style={[styles.tabText, isLogin && styles.activeTabText]}>
                  Login
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tab, !isLogin && styles.activeTab]}
                onPress={() => setIsLogin(false)}
              >
                <Text style={[styles.tabText, !isLogin && styles.activeTabText]}>
                  Register
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.form}>
              {!isLogin && (
                <View style={styles.inputContainer}>
                  <MaterialCommunityIcons
                    name="email-outline"
                    size={20}
                    color={MEDIUM_GREY}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Email"
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoComplete="email"
                  />
                </View>
              )}

              <View style={styles.inputContainer}>
                <MaterialCommunityIcons
                  name="account-outline"
                  size={20}
                  color={MEDIUM_GREY}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder={isLogin ? "Username or Email" : "Username"}
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoComplete="username"
                />
              </View>

              <View style={styles.inputContainer}>
                <MaterialCommunityIcons
                  name="lock-outline"
                  size={20}
                  color={MEDIUM_GREY}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoComplete="password"
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeIcon}
                >
                  <MaterialCommunityIcons
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={20}
                    color={MEDIUM_GREY}
                  />
                </TouchableOpacity>
              </View>

              {!isLogin && (
                <View style={styles.inputContainer}>
                  <MaterialCommunityIcons
                    name="lock-check-outline"
                    size={20}
                    color={MEDIUM_GREY}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Confirm Password"
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry={!showConfirmPassword}
                    autoComplete="password"
                  />
                  <TouchableOpacity
                    onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                    style={styles.eyeIcon}
                  >
                    <MaterialCommunityIcons
                      name={showConfirmPassword ? "eye-off-outline" : "eye-outline"}
                      size={20}
                      color={MEDIUM_GREY}
                    />
                  </TouchableOpacity>
                </View>
              )}

              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleAuth}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.buttonText}>
                    {isLogin ? 'Login' : 'Create Account'}
                  </Text>
                )}
              </TouchableOpacity>

              {!isLogin && (
                <Text style={styles.hint}>
                  Username: 3-20 characters (letters, numbers, underscores)
                </Text>
              )}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaProvider>
  );
}

// Import SafeAreaProvider for standalone use
import { SafeAreaProvider } from 'react-native-safe-area-context';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
    paddingTop: 60,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: DARK_GREY,
    marginTop: 16,
  },
  subtitle: {
    fontSize: 16,
    color: MEDIUM_GREY,
    marginTop: 8,
  },
  card: {
    backgroundColor: LIGHT_GREY,
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#E0E0E0',
    borderRadius: 12,
    padding: 4,
    marginBottom: 24,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  tabText: {
    fontSize: 16,
    fontWeight: '600',
    color: MEDIUM_GREY,
  },
  activeTabText: {
    color: DARK_GREY,
  },
  form: {
    gap: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 52,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: DARK_GREY,
  },
  eyeIcon: {
    padding: 4,
    marginLeft: 8,
  },
  button: {
    backgroundColor: AMBER,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  hint: {
    fontSize: 12,
    color: MEDIUM_GREY,
    textAlign: 'center',
    marginTop: -8,
  },
});

