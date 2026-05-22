import React from 'react';
import AppDialogModal, { AppDialogCard, AppDialogOverlay } from './AppDialog';

function mapFeedbackTone(tone) {
  if (tone === 'error') return 'error';
  if (tone === 'success') return 'success';
  return 'neutral';
}

/**
 * @param {object} props
 * @param {string} props.title
 * @param {string} props.message
 * @param {'success' | 'error'} [props.tone='success']
 * @param {() => void} props.onClose
 */
export function AppFeedbackCard({ title, message, tone = 'success', onClose }) {
  return (
    <AppDialogCard
      title={title}
      message={message}
      tone={mapFeedbackTone(tone)}
      onClose={onClose}
    />
  );
}

export function AppFeedbackOverlay({ title, message, tone = 'success', onClose }) {
  return (
    <AppDialogOverlay
      title={title}
      message={message}
      tone={mapFeedbackTone(tone)}
      onClose={onClose}
    />
  );
}

/**
 * Standalone success/error popup — same card style as {@link AppDialogModal}.
 * Default tone is success (backwards compatible with older call sites).
 */
export default function AppFeedbackModal({ tone, ...rest }) {
  return <AppDialogModal {...rest} tone={mapFeedbackTone(tone ?? 'success')} />;
}
