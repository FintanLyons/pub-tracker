/**
 * Single source for EAS project UUID (push + app.config extra.eas.projectId).
 * Override with EXPO_PUBLIC_EAS_PROJECT_ID in .env if needed.
 */
export const EAS_PROJECT_ID =
  (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_EAS_PROJECT_ID) ||
  'cd970f03-6d5e-4e0d-bd04-ffc7afa5a1ed';
