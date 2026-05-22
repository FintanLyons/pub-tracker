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
  FlatList,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';
import { AppDialogOverlay } from './AppDialog';
import {
  PUB_FEATURES_DISPLAY,
  defaultFeatureSwitchState,
  featureMapFromPubFeatureArray,
} from '../constants/pubFeatures';
import { normalizeUkPostcode } from '../utils/ukPostcode';

const MAX_PHOTOS = 5;

/** UK national numbers are at most 11 digits including trunk 0 (e.g. 02079460123, 07123456789). */
const UK_PHONE_DIGITS_MAX = 11;

const FOUNDED_YEAR_MIN = 1000;

/** Example shown under the opening hours field on reports. */
const OPENING_HOURS_EXAMPLE = 'Mon–Fri 11:00–23:00; Sat 11:00–23:30; Sun 12:00–22:30';

function openingHoursPrefillFromPub(pub) {
  if (!pub) return '';
  const oh = pub.opening_hours;
  if (oh != null && String(oh).trim()) return String(oh).trim();
  const ct = pub.closing_time;
  if (ct == null || ct === '') return '';
  const s = String(ct).trim();
  if (!s) return '';
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
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
  const [housenumber, setHousenumber] = useState('');
  const [street, setStreet] = useState('');
  const [postcode, setPostcode] = useState('');
  const [website, setWebsite] = useState('');
  const [phone, setPhone] = useState('');
  const [openingHours, setOpeningHours] = useState('');
  const [history, setHistory] = useState('');
  const [features, setFeatures] = useState(defaultFeatureSwitchState);
  const [imageUris, setImageUris] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [photoPermissionDialog, setPhotoPermissionDialog] = useState(false);
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
      setHousenumber(initialPub.addrHousenumber || '');
      setStreet(initialPub.addrStreet || '');
      setPostcode('');
      setWebsite(initialPub.website ? String(initialPub.website) : '');
      setPhone(digitsOnlyPhone(initialPub.phone));
      setOpeningHours(openingHoursPrefillFromPub(initialPub));
      setHistory(historyPrefillFromPub(initialPub));
      setFeatures(featureMapFromPubFeatureArray(initialPub.features));
    } else {
      setPubName('');
      setChainOrIndependent('');
      setFoundedYear(null);
      setHousenumber('');
      setStreet('');
      setPostcode('');
      setWebsite('');
      setPhone('');
      setOpeningHours('');
      setHistory('');
      setFeatures(defaultFeatureSwitchState());
    }
    setPubStillOpen(true);
    setImageUris([]);
    setErrorMessage(null);
    setFoundedPickerVisible(false);
    setPhotoPermissionDialog(false);
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
      setPhotoPermissionDialog(true);
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

  const handlePostcodeChange = useCallback((text) => {
    setPostcode(text.toUpperCase());
  }, []);

  const handlePostcodeBlur = useCallback(() => {
    const normalised = normalizeUkPostcode(postcode);
    if (normalised) setPostcode(normalised);
  }, [postcode]);

  const canSubmit =
    mode === 'missing_pub'
      ? pubName.trim().length > 0
        && housenumber.trim().length > 0
        && street.trim().length > 0
        && postcode.trim().length > 0
      : true;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await onSubmit({
        pubName: pubName.trim(),
        chainOrIndependent: chainOrIndependent.trim(),
        founded: foundedYear != null ? String(foundedYear) : '',
        housenumber: housenumber.trim(),
        street: street.trim(),
        postcode: postcode.trim(),
        website: website.trim(),
        phone: phone.trim(),
        closingTime: openingHours.trim(),
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
    housenumber,
    street,
    postcode,
    website,
    phone,
    openingHours,
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

              <Text style={styles.label}>Ownership</Text>
              <Text style={styles.sectionHint}>Chain, brewery, or independent operator</Text>
              <TextInput
                style={styles.textInput}
                placeholder=""
                placeholderTextColor={COLORS.inputPlaceholder}
                value={chainOrIndependent}
                onChangeText={setChainOrIndependent}
                autoCorrect={false}
                editable={!isSubmitting}
              />

              <Text style={styles.label}>Year founded</Text>
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
                  {foundedYear != null ? String(foundedYear) : 'Select year'}
                </Text>
                <MaterialCommunityIcons name="calendar-month-outline" size={22} color={COLORS.mediumGrey} />
              </TouchableOpacity>

              <Text style={styles.sectionTitle}>Address</Text>

              <Text style={styles.label}>
                House number{mode === 'missing_pub' ? ' *' : ' (optional)'}
              </Text>
              {mode !== 'missing_pub' ? (
                <Text style={styles.sectionHint}>Building number or name, if known</Text>
              ) : null}
              <TextInput
                style={styles.textInput}
                placeholder=""
                placeholderTextColor={COLORS.inputPlaceholder}
                value={housenumber}
                onChangeText={setHousenumber}
                autoCorrect={false}
                editable={!isSubmitting}
              />

              <Text style={styles.label}>
                Street{mode === 'missing_pub' ? ' *' : ' (optional)'}
              </Text>
              <TextInput
                style={styles.textInput}
                placeholder=""
                placeholderTextColor={COLORS.inputPlaceholder}
                value={street}
                onChangeText={setStreet}
                autoCorrect={false}
                editable={!isSubmitting}
              />

              <Text style={styles.label}>
                Postcode{mode === 'missing_pub' ? ' *' : ' (optional)'}
              </Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. SW1A 1AA"
                placeholderTextColor={COLORS.inputPlaceholder}
                value={postcode}
                onChangeText={handlePostcodeChange}
                onBlur={handlePostcodeBlur}
                autoCapitalize="characters"
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

              <Text style={styles.label}>Opening hours</Text>
              <Text style={styles.sectionHint}>
                e.g. {OPENING_HOURS_EXAMPLE}
              </Text>
              <TextInput
                style={[styles.textInput, styles.textInputMultiline]}
                placeholder=""
                placeholderTextColor={COLORS.inputPlaceholder}
                value={openingHours}
                onChangeText={setOpeningHours}
                multiline
                textAlignVertical="top"
                autoCorrect={false}
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

              <Text style={styles.label}>About this pub</Text>
              <Text style={styles.sectionHint}>Shown on the pub card as the main description</Text>
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

              <Text style={styles.sectionTitle}>Photos</Text>
              <Text style={styles.sectionHint}>
                Up to {MAX_PHOTOS} — applied to the pub listing when your report is accepted
              </Text>
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
        {photoPermissionDialog ? (
          <AppDialogOverlay
            title="Photos"
            message="Photo library access is needed to attach images. You can enable it in your device settings."
            tone="neutral"
            onClose={() => setPhotoPermissionDialog(false)}
          />
        ) : null}
        {foundedPickerVisible ? (
          <View style={styles.yearPickerOverlay} pointerEvents="box-none">
            <TouchableOpacity
              style={styles.yearPickerDismissArea}
              activeOpacity={1}
              onPress={() => setFoundedPickerVisible(false)}
              accessibilityLabel="Dismiss year picker"
            />
            <View style={styles.yearPickerSheet} pointerEvents="auto">
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
                initialNumToRender={24}
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
        ) : null}
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
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    zIndex: 20,
    elevation: 20,
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
