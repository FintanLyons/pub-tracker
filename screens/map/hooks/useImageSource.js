import { useCallback } from 'react';
import {
  getPubPhotoPlaceholderSource,
  PUB_PHOTO_PLACEHOLDER_URL,
} from '../../../constants/pubPhotoPlaceholder';

/** @returns {import('react-native').ImageSourcePropType} */
export function useImageSource() {
  return useCallback((photoUrl) => {
    if (!photoUrl || !String(photoUrl).trim()) return getPubPhotoPlaceholderSource();

    if (photoUrl === '__local_placeholder__') {
      return getPubPhotoPlaceholderSource();
    }

    if (
      PUB_PHOTO_PLACEHOLDER_URL &&
      photoUrl === PUB_PHOTO_PLACEHOLDER_URL
    ) {
      return { uri: PUB_PHOTO_PLACEHOLDER_URL };
    }

    if (photoUrl.startsWith('http://') || photoUrl.startsWith('https://')) {
      return { uri: photoUrl };
    }

    return getPubPhotoPlaceholderSource();
  }, []);
}
