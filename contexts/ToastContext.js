import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Snackbar } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';

/** Tab bar height (60) + gap, matching navigation/TabNavigator.js. */
const TAB_BAR_CLEARANCE = 68;
const TOAST_DURATION_MS = 4000;

const ToastContext = createContext({ showToast: () => {} });

/**
 * Brief, non-blocking message at the bottom of the screen (e.g. "Couldn't save").
 * Not visible above RN <Modal>s — show inline errors inside modals instead.
 */
export function ToastProvider({ children }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState({ visible: false, message: '' });

  const showToast = useCallback((message) => {
    if (!message) return;
    setToast({ visible: true, message: String(message) });
  }, []);

  const hideToast = useCallback(() => {
    setToast((t) => ({ ...t, visible: false }));
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Snackbar
        visible={toast.visible}
        onDismiss={hideToast}
        duration={TOAST_DURATION_MS}
        wrapperStyle={[styles.wrapper, { bottom: TAB_BAR_CLEARANCE + insets.bottom }]}
        style={styles.snackbar}
        action={{ label: 'OK', textColor: COLORS.amber, onPress: hideToast }}
      >
        {toast.message}
      </Snackbar>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

const styles = StyleSheet.create({
  wrapper: {
    zIndex: 2000,
    elevation: 20,
  },
  snackbar: {
    backgroundColor: COLORS.charcoal,
  },
});
