import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Switch,
  Dimensions,
  Alert,
  FlatList,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';
import {
  PUB_FEATURES_DISPLAY,
  defaultFeatureSwitchState,
  featureMapFromPubFeatureArray,
} from '../constants/pubFeatures';

const MAX_PHOTOS = 6;

/** UK national numbers are at most 11 digits including trunk 0 (e.g. 02079460123, 07123456789). */
const UK_PHONE_DIGITS_MAX = 11;

const FOUNDED_YEAR_MIN = 1000;

function closingTimePrefillFromPub(pub) {
  if (!pub) return '';
  const ct = pub.closing_time;
  if (ct == null || ct === '') return '';
  const n = Number(ct);
  if (!Number.isFinite(n)) return '';
  return `${String(Math.floor(n)).padStart(2, '0')}:00`;
}

/** Card `history`; falls back to `description` (DB long copy) when history is empty. */
function historyPrefillFromPub(pub) {
  if (!pub) return '';
  const h = pub.history;
  if (h != null && String(h).trim()) return String(h);
  const d = pub.description;
  if (d != null && String(d).trim()) return String(d);
  return '';
}

function digitsOnlyPhone(raw) {
  return String(raw || '').replace(/\D/g, '').slice(0, UK_PHONE_DIGITS_MAX);
}

/** Up to 4 digits → display HH:mm (colon inserted after hour). */
function formatClosingTimeDigits(raw) {
  const d = String(raw).replace(/\D/g, '').slice(0, 4);
  if (d.length === 0) return '';
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}:${d.slice(2)}`;
}

/** Empty = valid (optional). Otherwise strict HH:mm, 00:00–23:59. */
function isValid24hClosing(display) {
  const s = String(display || '').trim();
  if (!s) return true;
  const m = s.match(/^(\d{2}):(\d{2})$/);
  if (!m) return false;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

function foundedYearFromPub(pub) {
  if (!pub || pub.founded == null || pub.founded === '') return null;
  const n = parseInt(String(pub.founded).trim(), 10);
  if (!Number.isFinite(n)) return null;
  const end = new Date().getFullYear();
  if (n < FOUNDED_YEAR_MIN || n > end) return null;
  return n;
}

export default function PubReportFormModal({
  visible,
  onClose,
  mode,
  initialPub = null,
  onSubmit,
  onSuccess,
}) {
  const [pubName, setPubName] = useState('');
  const [chainOrIndependent, setChainOrIndependent] = useState('');
  const [foundedYear, setFoundedYear] = useState(null);
  const [foundedPickerVisible, setFoundedPickerVisible] = useState(false);
  const [address, setAddress] = useState('');
  const [website, setWebsite] = useState('');
  const [phone, setPhone] = useState('');
  const [closingTime, setClosingTime] = useState('');
  const [history, setHistory] = useState('');
  const [features, setFeatures] = useState(defaultFeatureSwitchState);
  const [imageUris, setImageUris] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  /** pub_correction only: true = still operating, false = permanently closed (not opening hours). */
  const [pubStillOpen, setPubStillOpen] = useState(true);

  const { width: screenW, height: screenH } = Dimensions.get('window');
  const modalW = Math.min(screenW - 24, 440);
  const modalMaxH = Math.min(screenH * 0.9, 780);

  const foundedYearOptions = useMemo(() => {
    const end = new Date().getFullYear();
    return Array.from({ length: end - FOUNDED_YEAR_MIN + 1 }, (_, i) => end - i);
  }, []);

  useEffect(() => {
    if (!visible) return;

    if (mode === 'pub_correction' && initialPub) {
      setPubName(initialPub.name || '');
      setChainOrIndependent(initialPub.ownership || '');
      setFoundedYear(foundedYearFromPub(initialPub));
      setAddress(initialPub.address || '');
      setWebsite(initialPub.website ? String(initialPub.website) : '');
      setPhone(digitsOnlyPhone(initialPub.phone));
      setClosingTime(closingTimePrefillFromPub(initialPub));
      setHistory(historyPrefillFromPub(initialPub));
      setFeatures(featureMapFromPubFeatureArray(initialPub.features));
    } else {
      setPubName('');
      setChainOrIndependent('');
      setFoundedYear(null);
      setAddress('');
      setWebsite('');
      setPhone('');
      setClosingTime('');
      setHistory('');
      setFeatures(defaultFeatureSwitchState());
    }
    setPubStillOpen(true);
    setImageUris([]);
    setErrorMessage(null);
    setFoundedPickerVisible(false);
  }, [visible, mode, initialPub?.id]);

  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    onClose?.();
  }, [isSubmitting, onClose]);

  const setFeature = useCallback((name, value) => {
    setFeatures((prev) => ({ ...prev, [name]: value }));
  }, []);

  const pickImages = useCallback(async () => {
    const remaining = MAX_PHOTOS - imageUris.length;
    if (remaining <= 0) return;

    // Library permission is only requested when the user taps "Add photos", never at app launch.
    const { status: existing } = await ImagePicker.getMediaLibraryPermissionsAsync();
    let granted = existing === 'granted';
    if (!granted) {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      granted = status === 'granted';
    }
    if (!granted) {
      Alert.alert(
        'Photos',
        'Photo library access is needed to attach images. You can enable it in your device settings.'
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.85,
      selectionLimit: remaining,
    });

    if (result.canceled) return;
    const assets = result.assets || [];
    setImageUris((prev) => [...prev, ...assets.map((a) => a.uri)].slice(0, MAX_PHOTOS));
  }, [imageUris.length]);

  const removeImageAt = useCallback((index) => {
    setImageUris((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handlePhoneChange = useCallback((text) => {
    setPhone(digitsOnlyPhone(text));
  }, []);

  const handleClosingTimeChange = useCallback((text) => {
    setClosingTime(formatClosingTimeDigits(text));
  }, []);

  const canSubmit =
    mode === 'missing_pub'
      ? pubName.trim().length > 0 && address.trim().length > 0
      : history.trim().length > 0;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || isSubmitting) return;
    const ct = closingTime.trim();
    if (!isValid24hClosing(ct)) {
      setErrorMessage('Closing time must be 24-hour HH:mm (e.g. 22:30), or leave blank.');
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await onSubmit({
        pubName: pubName.trim(),
        chainOrIndependent: chainOrIndependent.trim(),
        founded: foundedYear != null ? String(foundedYear) : '',
        address: address.trim(),
        website: website.trim(),
        phone: phone.trim(),
        closingTime: ct,
        history: history.trim(),
        features,
        imageUris,
        stillOperating: mode === 'pub_correction' ? pubStillOpen : undefined,
      });
      onClose?.();
      onSuccess?.();
    } catch (err) {
      setErrorMessage(
        err?.message || 'Unable to submit report right now. Please try again in a moment.'
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [
    canSubmit,
    isSubmitting,
    onSubmit,
    onClose,
    onSuccess,
    pubName,
    chainOrIndependent,
    foundedYear,
    address,
    website,
    phone,
    closingTime,
    history,
    features,
    imageUris,
    mode,
    pubStillOpen,
  ]);

  const title = mode === 'missing_pub' ? 'Report missing pub' : 'Report incorrect information';

  return (
    <>
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.overlayTouchable}
          activeOpacity={1}
          onPress={handleClose}
        />
        <View style={[styles.modalContainer, { width: modalW, height: modalMaxH }]}>
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              <TouchableOpacity
                onPress={handleClose}
                style={styles.closeButton}
                disabled={isSubmitting}
              >
                <MaterialCommunityIcons name="close" size={20} color={COLORS.mediumGrey} />
              </TouchableOpacity>
            </View>


            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator
              automaticallyAdjustKeyboardInsets
            >
              {mode === 'pub_correction' ? (
                <View style={styles.operatingBlock}>
                  <Text style={styles.operatingTitle}>Is this pub still operating?</Text>
                  <View style={styles.operatingRow}>
                    <TouchableOpacity
                      style={[
                        styles.operatingButton,
                        pubStillOpen && styles.operatingButtonSelected,
                      ]}
                      onPress={() => setPubStillOpen(true)}
                      disabled={isSubmitting}
                      activeOpacity={0.85}
                    >
                      <Text
                        style={[
                          styles.operatingButtonText,
                          pubStillOpen && styles.operatingButtonTextSelected,
                        ]}
                      >
                        Still Open
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.operatingButton,
                        !pubStillOpen && styles.operatingButtonSelected,
                      ]}
                      onPress={() => setPubStillOpen(false)}
                      disabled={isSubmitting}
                      activeOpacity={0.85}
                    >
                      <Text
                        style={[
                          styles.operatingButtonText,
                          !pubStillOpen && styles.operatingButtonTextSelected,
                        ]}
                      >
                        {'Permanently Closed\n/ Not a Pub'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}

              <Text style={styles.label}>Pub name *</Text>
              <TextInput
                style={styles.textInput}
                placeholder=""
                placeholderTextColor={COLORS.inputPlaceholder}
                value={pubName}
                onChangeText={setPubName}
                autoCorrect={false}
                editable={!isSubmitting}
              />

              <Text style={styles.label}>Chain / independent</Text>
              <TextInput
                style={styles.textInput}
                placeholder=""
                placeholderTextColor={COLORS.inputPlaceholder}
                value={chainOrIndependent}
                onChangeText={setChainOrIndependent}
                autoCorrect={false}
                editable={!isSubmitting}
              />

              <Text style={styles.label}>Founded</Text>
              <TouchableOpacity
                style={[styles.textInput, styles.yearPickerTrigger]}
                onPress={() => !isSubmitting && setFoundedPickerVisible(true)}
                disabled={isSubmitting}
                activeOpacity={0.7}
              >
                <Text
                  style={
                    foundedYear != null ? styles.yearPickerTriggerValue : styles.yearPickerTriggerHint
                  }
                  numberOfLines={1}
                >
                  {foundedYear != null ? String(foundedYear) : ''}
                </Text>
                <MaterialCommunityIcons name="calendar-month-outline" size={22} color={COLORS.mediumGrey} />
              </TouchableOpacity>

              <Text style={styles.label}>Pub address {mode === 'missing_pub' ? '*' : ''}</Text>
              <TextInput
                style={[styles.textInput, styles.textInputMultiline]}
                placeholder=""
                placeholderTextColor={COLORS.inputPlaceholder}
                value={address}
                onChangeText={setAddress}
                multiline
                textAlignVertical="top"
                autoCorrect={false}
                editable={!isSubmitting}
              />

              <Text style={styles.label}>Website</Text>
              <TextInput
                style={styles.textInput}
                placeholder=""
                placeholderTextColor={COLORS.inputPlaceholder}
                value={website}
                onChangeText={setWebsite}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="default"
                editable={!isSubmitting}
              />

              <Text style={styles.label}>Phone number</Text>
              <TextInput
                style={styles.textInput}
                placeholder=""
                placeholderTextColor={COLORS.inputPlaceholder}
                value={phone}
                onChangeText={handlePhoneChange}
                keyboardType="number-pad"
                autoCorrect={false}
                editable={!isSubmitting}
              />

              <Text style={styles.label}>Typical closing time</Text>
              <TextInput
                style={styles.textInput}
                placeholder=""
                placeholderTextColor={COLORS.inputPlaceholder}
                value={closingTime}
                onChangeText={handleClosingTimeChange}
                keyboardType="number-pad"
                autoCorrect={false}
                maxLength={5}
                editable={!isSubmitting}
              />

              <Text style={styles.sectionTitle}>Features</Text>
              {PUB_FEATURES_DISPLAY.map(({ name, icon }) => (
                <View key={name} style={styles.switchRow}>
                  <MaterialCommunityIcons name={icon} size={22} color={COLORS.charcoal} />
                  <Text style={styles.switchLabel}>{name}</Text>
                  <Switch
                    style={styles.featureSwitch}
                    value={!!features[name]}
                    onValueChange={(v) => setFeature(name, v)}
                    disabled={isSubmitting}
                    trackColor={{ false: COLORS.lightGrey, true: COLORS.amber }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              ))}

              <Text style={styles.label}>
                History {mode === 'pub_correction' ? '*' : ''}
              </Text>
              <TextInput
                style={[styles.textInput, styles.textInputTall]}
                placeholder=""
                placeholderTextColor={COLORS.inputPlaceholder}
                value={history}
                onChangeText={setHistory}
                multiline
                textAlignVertical="top"
                editable={!isSubmitting}
              />

              <Text style={styles.sectionTitle}>Pub photos</Text>
              <View style={styles.photoRow}>
                <TouchableOpacity
                  style={styles.addPhotoButton}
                  onPress={pickImages}
                  disabled={isSubmitting || imageUris.length >= MAX_PHOTOS}
                >
                  <MaterialCommunityIcons
                    name="camera-plus-outline"
                    size={28}
                    color={COLORS.amber}
                  />
                  <Text style={styles.addPhotoText}>Add photos</Text>
                </TouchableOpacity>
                {imageUris.map((uri, index) => (
                  <View key={uri} style={styles.thumbWrap}>
                    <Image source={{ uri }} style={styles.thumb} contentFit="cover" />
                    <TouchableOpacity
                      style={styles.thumbRemove}
                      onPress={() => removeImageAt(index)}
                      disabled={isSubmitting}
                    >
                      <MaterialCommunityIcons name="close-circle" size={22} color="#FFFFFF" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>

              {errorMessage ? <Text style={styles.errorMessage}>{errorMessage}</Text> : null}

              <TouchableOpacity
                style={[styles.submitButton, (!canSubmit || isSubmitting) && styles.submitButtonDisabled]}
                onPress={handleSubmit}
                activeOpacity={0.8}
                disabled={!canSubmit || isSubmitting}
              >
                <Text style={styles.submitButtonText}>
                  {isSubmitting ? 'Submitting…' : 'Submit report'}
                </Text>
              </TouchableOpacity>
            </ScrollView>
        </View>
      </View>
    </Modal>

    <Modal
      visible={foundedPickerVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setFoundedPickerVisible(false)}
    >
      <View style={styles.yearPickerOverlay}>
        <TouchableOpacity
          style={styles.yearPickerDismissArea}
          activeOpacity={1}
          onPress={() => setFoundedPickerVisible(false)}
        />
        <View style={styles.yearPickerSheet}>
          <Text style={styles.yearPickerTitle}>Year founded</Text>
          <TouchableOpacity
            style={styles.yearPickerClearRow}
            onPress={() => {
              setFoundedYear(null);
              setFoundedPickerVisible(false);
            }}
          >
            <Text style={styles.yearPickerClearText}>Clear selection</Text>
          </TouchableOpacity>
          <FlatList
            data={foundedYearOptions}
            keyExtractor={(item) => String(item)}
            style={[styles.yearPickerList, { maxHeight: Math.min(screenH * 0.42, 340) }]}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.yearPickerRow,
                  foundedYear === item && styles.yearPickerRowSelected,
                ]}
                onPress={() => {
                  setFoundedYear(item);
                  setFoundedPickerVisible(false);
                }}
              >
                <Text
                  style={[
                    styles.yearPickerRowText,
                    foundedYear === item && styles.yearPickerRowTextSelected,
                  ]}
                >
                  {item}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayTouchable: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    paddingBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 10,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.charcoal,
    flex: 1,
    paddingRight: 8,
  },
  closeButton: {
    padding: 4,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.mediumGrey,
    marginBottom: 14,
  },
  operatingBlock: {
    marginBottom: 16,
  },
  operatingTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.charcoal,
    marginBottom: 6,
  },
  operatingHint: {
    fontSize: 12,
    color: COLORS.mediumGrey,
    marginBottom: 10,
    lineHeight: 16,
  },
  operatingRow: {
    flexDirection: 'row',
    gap: 10,
  },
  operatingButton: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: COLORS.lightGrey,
    backgroundColor: '#FAFAFA',
    justifyContent: 'center',
    alignItems: 'center',
  },
  operatingButtonSelected: {
    borderColor: COLORS.amber,
    backgroundColor: '#FFF9E8',
  },
  operatingButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.charcoal,
    textAlign: 'center',
  },
  operatingButtonTextSelected: {
    color: COLORS.charcoal,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  label: {
    fontSize: 14,
    color: COLORS.charcoal,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.charcoal,
    marginTop: 14,
    marginBottom: 4,
  },
  sectionHint: {
    fontSize: 13,
    color: COLORS.mediumGrey,
    marginBottom: 10,
  },
  textInput: {
    borderWidth: 1,
    borderColor: COLORS.lightGrey,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: COLORS.charcoal,
    backgroundColor: '#FAFAFA',
    marginBottom: 12,
  },
  textInputMultiline: {
    minHeight: 72,
  },
  textInputTall: {
    minHeight: 100,
  },
  yearPickerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  yearPickerTriggerValue: {
    flex: 1,
    fontSize: 16,
    color: COLORS.charcoal,
    marginRight: 8,
  },
  yearPickerTriggerHint: {
    flex: 1,
    fontSize: 16,
    color: COLORS.inputPlaceholder,
    marginRight: 8,
  },
  yearPickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  yearPickerDismissArea: {
    flex: 1,
  },
  yearPickerSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
    paddingHorizontal: 16,
    maxHeight: '85%',
  },
  yearPickerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.charcoal,
    textAlign: 'center',
    paddingVertical: 14,
  },
  yearPickerClearRow: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.divider,
    marginBottom: 4,
  },
  yearPickerClearText: {
    fontSize: 16,
    color: COLORS.amber,
    fontWeight: '600',
    textAlign: 'center',
  },
  yearPickerList: {
    width: '100%',
  },
  yearPickerRow: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.lightGrey,
  },
  yearPickerRowSelected: {
    backgroundColor: '#FFF7E6',
  },
  yearPickerRowText: {
    fontSize: 17,
    color: COLORS.charcoal,
    textAlign: 'center',
  },
  yearPickerRowTextSelected: {
    fontWeight: '700',
    color: COLORS.charcoal,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.lightGrey,
    gap: 10,
  },
  switchLabel: {
    flex: 1,
    fontSize: 15,
    color: COLORS.charcoal,
  },
  featureSwitch: {
    ...(Platform.OS === 'ios'
      ? {
          transform: [{ scaleX: 0.9 }, { scaleY: 0.9 }],
        }
      : null),
  },
  photoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  addPhotoButton: {
    width: 88,
    height: 88,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.amber,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF7E6',
  },
  addPhotoText: {
    fontSize: 11,
    color: COLORS.charcoal,
    marginTop: 4,
    fontWeight: '600',
  },
  thumbWrap: {
    width: 88,
    height: 88,
    borderRadius: 8,
    overflow: 'hidden',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  thumbRemove: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12,
  },
  errorMessage: {
    color: '#D9534F',
    marginBottom: 12,
  },
  submitButton: {
    backgroundColor: COLORS.amber,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  submitButtonDisabled: {
    backgroundColor: COLORS.lightGrey,
    opacity: 0.7,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
