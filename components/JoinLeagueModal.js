import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { joinLeagueByCode } from '../services/LeagueService';

const DARK_GREY = '#2C2C2C';
const LIGHT_GREY = '#F5F5F5';
const MEDIUM_GREY = '#757575';
const AMBER = '#D4A017';

export default function JoinLeagueModal({
  visible,
  onClose,
  currentUserId,
  onJoined,
}) {
  const [leagueCode, setLeagueCode] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) {
      setLeagueCode('');
      setLoading(false);
    }
  }, [visible]);

  const handleJoin = async () => {
    const trimmedCode = leagueCode.trim().toUpperCase();
    if (!trimmedCode) {
      Alert.alert('Invalid Code', 'Please enter a league code to continue.');
      return;
    }

    if (!currentUserId) {
      Alert.alert('Not Logged In', 'You must be logged in to join a league.');
      return;
    }

    try {
      setLoading(true);
      const { league, alreadyMember } = await joinLeagueByCode(currentUserId, trimmedCode);

      if (alreadyMember) {
        Alert.alert(
          'Already Joined',
          `You are already a member of ${league.name}.`,
        );
      } else {
        Alert.alert(
          'Joined League',
          `You have joined ${league.name}.`,
          [{ text: 'OK', onPress: onClose }],
        );
        if (onJoined) {
          onJoined();
        }
      }
    } catch (error) {
      console.error('Error joining league:', error);
      Alert.alert(
        'Join Failed',
        error.message || 'Unable to join league. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>Join a League</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <MaterialCommunityIcons name="close" size={24} color={DARK_GREY} />
            </TouchableOpacity>
          </View>

          <Text style={styles.description}>
            Enter the league code provided by a friend to join their league.
          </Text>

          <Text style={styles.inputLabel}>League Code</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. ABC123"
            autoCapitalize="characters"
            value={leagueCode}
            onChangeText={(text) => setLeagueCode(text.toUpperCase())}
            maxLength={12}
            editable={!loading}
          />

          <TouchableOpacity
            style={[styles.joinButton, loading && styles.joinButtonDisabled]}
            onPress={handleJoin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <MaterialCommunityIcons name="account-check" size={20} color="#FFFFFF" />
                <Text style={styles.joinButtonText}>Join League</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  container: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: DARK_GREY,
  },
  closeButton: {
    padding: 4,
  },
  description: {
    fontSize: 14,
    color: MEDIUM_GREY,
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: DARK_GREY,
    marginBottom: 8,
  },
  input: {
    height: 48,
    borderRadius: 12,
    backgroundColor: LIGHT_GREY,
    paddingHorizontal: 16,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 2,
    color: DARK_GREY,
    marginBottom: 24,
  },
  joinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AMBER,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  joinButtonDisabled: {
    opacity: 0.6,
  },
  joinButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

