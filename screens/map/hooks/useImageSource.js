import { useCallback } from 'react';
import {
  getPubPhotoPlaceholderSource,
  PUB_PHOTO_PLACEHOLDER_URL,
} from '../../../constants/pubPhotoPlaceholder';

const imageMap = {
  'assets/PubPhotos/Abbey_Arms.jpeg': require('../../../assets/PubPhotos/Abbey_Arms.jpeg'),
  'assets/PubPhotos/Birchwood.jpeg': require('../../../assets/PubPhotos/Birchwood.jpeg'),
  'assets/PubPhotos/George_&_Dragon.jpeg': require('../../../assets/PubPhotos/George_&_Dragon.jpg'),
  'assets/PubPhotos/George_&_Dragon.jpg': require('../../../assets/PubPhotos/George_&_Dragon.jpg'),
  'assets/PubPhotos/Red_Lion_&_Pineapple.jpeg': require('../../../assets/PubPhotos/Red_Lion_&_Pineapple.jpg'),
  'assets/PubPhotos/Red_Lion_&_Pineapple.jpg': require('../../../assets/PubPhotos/Red_Lion_&_Pineapple.jpg'),
};

/** @returns {import('react-native').ImageSourcePropType | null} */
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

    if (photoUrl.startsWith('assets/')) {
      if (imageMap[photoUrl]) return imageMap[photoUrl];
      const jpgUrl = photoUrl.replace('.jpeg', '.jpg');
      if (imageMap[jpgUrl]) return imageMap[jpgUrl];
      const jpegUrl = photoUrl.replace('.jpg', '.jpeg');
      if (imageMap[jpegUrl]) return imageMap[jpegUrl];
      return null;
    }

    if (photoUrl.startsWith('http://') || photoUrl.startsWith('https://')) {
      return { uri: photoUrl };
    }

    return null;
  }, []);
}
