import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import AppDialogModal from '../components/AppDialog';

const AppAlertContext = createContext(null);

/**
 * App-styled dialogs (charcoal / amber) for messages that previously used React Native Alert.
 */
export function AppAlertProvider({ children }) {
  const [state, setState] = useState({
    visible: false,
    title: '',
    message: '',
    tone: 'neutral',
    buttons: null,
  });

  const hideAppAlert = useCallback(() => {
    setState((s) => ({ ...s, visible: false }));
  }, []);

  const showAppAlert = useCallback((options) => {
    const { title, message, tone = 'neutral', buttons } = options;
    setState({
      visible: true,
      title: title ?? '',
      message: message == null ? '' : String(message),
      tone,
      buttons: buttons ?? null,
    });
  }, []);

  const value = useMemo(
    () => ({ showAppAlert, hideAppAlert }),
    [showAppAlert, hideAppAlert],
  );

  return (
    <AppAlertContext.Provider value={value}>
      {children}
      <AppDialogModal
        visible={state.visible}
        title={state.title}
        message={state.message}
        tone={state.tone}
        onClose={hideAppAlert}
        buttons={state.buttons}
      />
    </AppAlertContext.Provider>
  );
}

export function useAppAlert() {
  const ctx = useContext(AppAlertContext);
  if (!ctx) {
    throw new Error('useAppAlert must be used within AppAlertProvider');
  }
  return ctx;
}
