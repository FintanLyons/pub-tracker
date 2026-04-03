import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Keyboard,
  Pressable,
  ScrollView,
  TouchableWithoutFeedback,
  Animated,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { joinLeagueByCode } from '../services/LeagueService';
import { COLORS } from '../constants/theme';

const BACKDROP = 'rgba(0, 0, 0, 0.5)';

export default function JoinLeagueModal({
  visible,
  onClose,
  currentUserId,
  onJoined,
}) {
  const [leagueCode, setLeagueCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [keyboardPad, setKeyboardPad] = useState(0);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const sheetSlideAnim = useRef(new Animated.Value(48)).current;
  const inputRef = useRef(null);

  useEffect(() => {
    if (!visible) {
      setLeagueCode('');
      setLoading(false);
      setFeedback(null);
      setKeyboardPad(0);
      fadeAnim.setValue(0);
      sheetSlideAnim.setValue(48);
      return;
    }

    fadeAnim.setValue(0);
    sheetSlideAnim.setValue(48);
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(sheetSlideAnim, {
        toValue: 0,
        duration: 280,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      inputRef.current?.blur();
      return;
    }
    const id = setTimeout(() => {
      inputRef.current?.focus();
    }, 320);
    return () => clearTimeout(id);
  }, [visible]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (e) => {
      if (Platform.OS === 'android') return;
      setKeyboardPad(e?.endCoordinates?.height ?? 0);
    };
    const onHide = () => {
      if (Platform.OS === 'android') return;
      setKeyboardPad(0);
    };

    const subShow = Keyboard.addListener(showEvent, onShow);
    const subHide = Keyboard.addListener(hideEvent, onHide);
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, []);

  const dismissFeedback = () => {
    const closeJoinModal = feedback?.closeJoinModal === true;
    setFeedback(null);
    if (closeJoinModal) {
      onClose();
    }
  };

  const handleJoin = async () => {
    const trimmedCode = leagueCode.trim().toUpperCase();
    if (!trimmedCode) {
      Keyboard.dismiss();
      setFeedback({
        title: 'Invalid code',
        message: 'Please enter a league code to continue.',
        tone: 'error',
      });
      return;
    }

    if (!currentUserId) {
      Keyboard.dismiss();
      setFeedback({
        title: 'Not logged in',
        message: 'You must be logged in to join a league.',
        tone: 'error',
      });
      return;
    }

    try {
      setLoading(true);
      const { league, alreadyMember } = await joinLeagueByCode(currentUserId, trimmedCode);

      if (alreadyMember) {
        Keyboard.dismiss();
        setFeedback({
          title: 'Already a member',
          message: `You are already in ${league.name}.`,
          tone: 'success',
          closeJoinModal: false,
        });
      } else {
        Keyboard.dismiss();
        setFeedback({
          title: "You're in!",
          message: `You've joined ${league.name}.`,
          tone: 'success',
          closeJoinModal: true,
        });
        if (onJoined) {
          onJoined();
        }
      }
    } catch (error) {
      console.error('Error joining league:', error);
      Keyboard.dismiss();
      setFeedback({
        title: "Couldn't join",
        message: error.message || 'Unable to join league. Please try again.',
        tone: 'error',
        closeJoinModal: false,
      });
    } finally {
      setLoading(false);
    }
  };

  const sheetBottomPad = Platform.OS === 'ios' ? keyboardPad : 0;

  return (
    <>
      <Modal
        visible={visible}
        animationType="none"
        transparent
        onRequestClose={onClose}
      >
        <View style={styles.modalRoot}>
          <Animated.View
            pointerEvents="none"
            style={[styles.backdropFill, { opacity: fadeAnim }]}
          />
          <View style={styles.sheetColumn}>
            <Pressable style={styles.backdropFlex} onPress={Keyboard.dismiss} />
            <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
              <Animated.View
                style={[
                  styles.sheetOuter,
                  {
                    marginBottom: sheetBottomPad,
                    transform: [{ translateY: sheetSlideAnim }],
                  },
                ]}
              >
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  keyboardDismissMode="on-drag"
                  bounces={false}
                  contentContainerStyle={styles.scrollContent}
                >
                  <View style={styles.header}>
                    <Text style={styles.title}>Join a League</Text>
                    <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                      <MaterialCommunityIcons name="close" size={24} color={COLORS.darkGrey} />
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.description}>
                    Enter the league code provided by a friend to join their league.
                  </Text>

                  <Text style={styles.inputLabel}>League Code</Text>
                  <TextInput
                    ref={inputRef}
                    style={styles.input}
                    placeholder="e.g. ABC123"
                    autoCapitalize="characters"
                    value={leagueCode}
                    onChangeText={(text) => setLeagueCode(text.toUpperCase())}
                    maxLength={12}
                    editable={!loading}
                    returnKeyType="done"
                    onSubmitEditing={handleJoin}
                    showSoftInputOnFocus
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
                </ScrollView>
              </Animated.View>
            </TouchableWithoutFeedback>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!feedback}
        animationType="fade"
        transparent
        onRequestClose={dismissFeedback}
      >
        <View style={styles.feedbackOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={dismissFeedback}
            accessibilityLabel="Dismiss"
          />
          <View style={styles.feedbackCard}>
            <View style={styles.feedbackHeader}>
              <Text style={styles.feedbackTitle}>{feedback?.title}</Text>
              <TouchableOpacity
                onPress={dismissFeedback}
                style={styles.feedbackClose}
                accessibilityLabel="Close"
                accessibilityRole="button"
              >
                <MaterialCommunityIcons name="close" size={22} color={COLORS.darkGrey} />
              </TouchableOpacity>
            </View>
            {feedback?.tone === 'success' ? (
              <View style={styles.feedbackIconWrap}>
                <MaterialCommunityIcons name="check-circle" size={48} color={COLORS.amber} />
              </View>
            ) : (
              <View style={styles.feedbackIconWrap}>
                <MaterialCommunityIcons name="alert-circle-outline" size={48} color={COLORS.errorRed} />
              </View>
            )}
            <Text style={styles.feedbackBody}>{feedback?.message}</Text>
            <View style={styles.feedbackActions}>
              <TouchableOpacity
                style={styles.feedbackPrimaryBtn}
                onPress={dismissFeedback}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="OK"
              >
                <Text style={styles.feedbackPrimaryBtnText}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
  },
  backdropFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BACKDROP,
  },
  sheetColumn: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  backdropFlex: {
    flex: 1,
    minHeight: 48,
  },
  sheetOuter: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 32,
    maxHeight: '88%',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
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
    color: COLORS.darkGrey,
  },
  closeButton: {
    padding: 4,
  },
  description: {
    fontSize: 14,
    color: COLORS.mediumGrey,
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.darkGrey,
    marginBottom: 8,
  },
  input: {
    height: 48,
    borderRadius: 12,
    backgroundColor: COLORS.lightGrey,
    paddingHorizontal: 16,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 2,
    color: COLORS.darkGrey,
    marginBottom: 24,
  },
  joinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.amber,
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
  feedbackOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  feedbackCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: COLORS.white,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 16,
  },
  feedbackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.divider,
  },
  feedbackTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.darkGrey,
    paddingRight: 8,
  },
  feedbackClose: {
    padding: 6,
    marginRight: -2,
  },
  feedbackIconWrap: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 8,
  },
  feedbackBody: {
    paddingHorizontal: 22,
    paddingTop: 8,
    paddingBottom: 20,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
    color: COLORS.accentGrey,
    textAlign: 'center',
  },
  feedbackActions: {
    paddingHorizontal: 22,
    paddingBottom: 22,
  },
  feedbackPrimaryBtn: {
    minHeight: 48,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.amber,
    alignSelf: 'stretch',
  },
  feedbackPrimaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.charcoal,
    textAlign: 'center',
  },
});
