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
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  updatePublicUsername,
  scheduleAuthUsernameMetadataSync,
  isValidUsernameFormat,
} from '../services/SecureAuthService';
import { useAuth } from '../contexts/AuthContext';
import PintGlassIcon from '../components/PintGlassIcon';
import { COLORS } from '../constants/theme';

export default function ChooseUsernameScreen() {
  const { user, logout, applyUserProfileRow } = useAuth();
  const [username, setUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const trimmed = username.trim();
    if (!trimmed) {
      Alert.alert('Error', 'Please enter a username');
      return;
    }
    if (!isValidUsernameFormat(trimmed)) {
      Alert.alert(
        'Invalid username',
        'Use 3–20 characters: letters, numbers, and underscores only.',
      );
      return;
    }

    if (!user?.id) {
      Alert.alert('Error', 'Not signed in');
      return;
    }

    try {
      setSubmitting(true);
      const row = await updatePublicUsername(user.id, trimmed);
      applyUserProfileRow(row);
      scheduleAuthUsernameMetadataSync();
    } catch (e) {
      const msg = e.message || 'Something went wrong';
      if (msg.includes('Username already taken')) {
        Alert.alert('Taken', 'That username is already in use. Try another.');
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <PintGlassIcon size={56} color={COLORS.amber} />
            <Text style={styles.title}>Choose your username</Text>
            <Text style={styles.body}>
              This is how friends see you on the leaderboard.{'\n'}
              <Text style={styles.emphasis}>{"You won't be able to change it later."}</Text>
            </Text>
          </View>

          <View style={styles.inputRow}>
            <MaterialCommunityIcons name="account-outline" size={18} color={COLORS.mediumGrey} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Username"
              placeholderTextColor={COLORS.mediumGrey}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              maxLength={20}
            />
          </View>

          <Text style={styles.hint}>3–20 characters: letters, numbers, underscores only</Text>

          <TouchableOpacity
            style={[styles.primaryBtn, submitting && styles.btnDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>Continue</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.signOutRow} onPress={() => logout()} disabled={submitting}>
            <Text style={styles.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 32,
  },
  header: {
    alignItems: 'center',
    marginBottom: 28,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.darkGrey,
    marginTop: 12,
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    color: COLORS.mediumGrey,
    marginTop: 10,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  emphasis: {
    fontWeight: '600',
    color: COLORS.darkGrey,
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
  hint: {
    fontSize: 11,
    color: COLORS.mediumGrey,
    marginTop: 8,
    textAlign: 'center',
  },
  primaryBtn: {
    backgroundColor: COLORS.amber,
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 20,
  },
  btnDisabled: {
    opacity: 0.55,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  signOutRow: {
    alignItems: 'center',
    marginTop: 24,
  },
  signOutText: {
    fontSize: 14,
    color: COLORS.mediumGrey,
    textDecorationLine: 'underline',
  },
});
