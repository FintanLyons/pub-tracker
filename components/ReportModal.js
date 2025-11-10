import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const AMBER = '#D4A017';
const DARK_CHARCOAL = '#1C1C1C';
const MEDIUM_GREY = '#757575';
const LIGHT_GREY = '#F5F5F5';

export default function ReportModal({ visible, onClose, onSend, pubName, pubArea }) {
  const [reportText, setReportText] = useState('');

  const handleSend = () => {
    if (reportText.trim()) {
      onSend(reportText);
      setReportText('');
      onClose();
    }
  };

  const handleClose = () => {
    setReportText('');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
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
                <Text style={styles.title}>Report</Text>
                <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
                  <MaterialCommunityIcons name="close" size={20} color={MEDIUM_GREY} />
                </TouchableOpacity>
              </View>

              <Text style={styles.subtitle}>
                Report issue for: {pubName}
              </Text>

              <TextInput
                style={styles.textInput}
                placeholder="Describe the incorrect information in this card"
                placeholderTextColor={MEDIUM_GREY}
                multiline={true}
                numberOfLines={6}
                value={reportText}
                onChangeText={setReportText}
                textAlignVertical="top"
              />

              <TouchableOpacity 
                style={[styles.sendButton, !reportText.trim() && styles.sendButtonDisabled]}
                onPress={handleSend}
                disabled={!reportText.trim()}
              >
                <Text style={styles.sendButtonText}>Send Report</Text>
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
  textInput: {
    borderWidth: 1,
    borderColor: LIGHT_GREY,
    borderRadius: 8,
    padding: 12,
    minHeight: 120,
    fontSize: 16,
    color: DARK_CHARCOAL,
    backgroundColor: '#FAFAFA',
    marginBottom: 16,
  },
  sendButton: {
    backgroundColor: AMBER,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: LIGHT_GREY,
    opacity: 0.6,
  },
  sendButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

