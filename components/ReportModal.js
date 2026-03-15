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
import { COLORS } from '../constants/theme';

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
                  <MaterialCommunityIcons name="close" size={20} color={COLORS.mediumGrey} />
                </TouchableOpacity>
              </View>

              <Text style={styles.subtitle}>
                Report issue for: {pubName}
              </Text>

              <TextInput
                style={styles.textInput}
                placeholder="Describe the incorrect information in this card"
                placeholderTextColor={COLORS.mediumGrey}
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
    color: COLORS.charcoal,
  },
  closeButton: {
    padding: 4,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.mediumGrey,
    marginBottom: 16,
  },
  textInput: {
    borderWidth: 1,
    borderColor: COLORS.lightGrey,
    borderRadius: 8,
    padding: 12,
    minHeight: 120,
    fontSize: 16,
    color: COLORS.charcoal,
    backgroundColor: '#FAFAFA',
    marginBottom: 16,
  },
  sendButton: {
    backgroundColor: COLORS.amber,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: COLORS.lightGrey,
    opacity: 0.6,
  },
  sendButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

