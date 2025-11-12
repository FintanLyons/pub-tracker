import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const AMBER = '#D4A017';
const DARK_CHARCOAL = '#1C1C1C';
const MEDIUM_GREY = '#757575';
const LIGHT_GREY = '#F5F5F5';

export default function ReportMissingPubModal({
  visible,
  onClose,
  onSubmit,
  isSubmitting = false,
  errorMessage = null,
}) {
  const [pubName, setPubName] = useState('');
  const [pubLocation, setPubLocation] = useState('');

  useEffect(() => {
    if (!visible) {
      setPubName('');
      setPubLocation('');
    }
  }, [visible]);

  const handleClose = () => {
    if (isSubmitting) {
      return;
    }
    onClose?.();
  };

  const handleSubmit = () => {
    if (!pubName.trim() || !pubLocation.trim() || isSubmitting) {
      return;
    }
    onSubmit?.({
      pubName: pubName.trim(),
      pubLocation: pubLocation.trim(),
    });
  };

  const isSubmitDisabled = isSubmitting || !pubName.trim() || !pubLocation.trim();

  return (
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
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardAvoidingView}
        >
          <View style={styles.modalContainer}>
            <View style={styles.header}>
              <Text style={styles.title}>Report Missing Pub</Text>
              <TouchableOpacity onPress={handleClose} style={styles.closeButton} disabled={isSubmitting}>
                <MaterialCommunityIcons name="close" size={20} color={MEDIUM_GREY} />
              </TouchableOpacity>
            </View>

            <Text style={styles.subtitle}>
              Enter the pub details below so the team can review it.
            </Text>

            <Text style={styles.label}>Pub name</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Enter pub name"
              placeholderTextColor={MEDIUM_GREY}
              value={pubName}
              onChangeText={setPubName}
              autoCorrect={false}
              editable={!isSubmitting}
            />

            <Text style={styles.label}>Location</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Enter pub location"
              placeholderTextColor={MEDIUM_GREY}
              value={pubLocation}
              onChangeText={setPubLocation}
              autoCorrect={false}
              editable={!isSubmitting}
            />

            <View style={styles.reportTypeContainer}>
              <MaterialCommunityIcons name="flag-outline" size={20} color={AMBER} />
              <Text style={styles.reportTypeText}>Report type: Pub Missing</Text>
            </View>

            {errorMessage ? (
              <Text style={styles.errorMessage}>{errorMessage}</Text>
            ) : null}

            <TouchableOpacity
              style={[styles.submitButton, isSubmitDisabled && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              activeOpacity={0.8}
              disabled={isSubmitDisabled}
            >
              <Text style={styles.submitButtonText}>
                {isSubmitting ? 'Submitting...' : 'Submit'}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
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
  keyboardAvoidingView: {
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    width: 340,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: DARK_CHARCOAL,
  },
  closeButton: {
    padding: 4,
  },
  subtitle: {
    fontSize: 14,
    color: MEDIUM_GREY,
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    color: DARK_CHARCOAL,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 4,
  },
  textInput: {
    borderWidth: 1,
    borderColor: LIGHT_GREY,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: DARK_CHARCOAL,
    backgroundColor: '#FAFAFA',
    marginBottom: 12,
  },
  reportTypeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF7E6',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  reportTypeText: {
    marginLeft: 8,
    color: DARK_CHARCOAL,
    fontWeight: '600',
  },
  errorMessage: {
    color: '#D9534F',
    marginBottom: 12,
  },
  submitButton: {
    backgroundColor: AMBER,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: LIGHT_GREY,
    opacity: 0.7,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

