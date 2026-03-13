import { useCallback } from 'react';

const imageMap = {
  'assets/PubPhotos/Abbey_Arms.jpeg': require('../../../assets/PubPhotos/Abbey_Arms.jpeg'),
  'assets/PubPhotos/Birchwood.jpeg': require('../../../assets/PubPhotos/Birchwood.jpeg'),
  'assets/PubPhotos/George_&_Dragon.jpeg': require('../../../assets/PubPhotos/George_&_Dragon.jpg'),
  'assets/PubPhotos/George_&_Dragon.jpg': require('../../../assets/PubPhotos/George_&_Dragon.jpg'),
  'assets/PubPhotos/Red_Lion_&_Pineapple.jpeg': require('../../../assets/PubPhotos/Red_Lion_&_Pineapple.jpg'),
  'assets/PubPhotos/Red_Lion_&_Pineapple.jpg': require('../../../assets/PubPhotos/Red_Lion_&_Pineapple.jpg'),
};

const placeholderImage = require('../../../assets/PubPhotos/Placeholder.jpg');

export function useImageSource() {
  return useCallback((photoUrl) => {
    if (!photoUrl) return placeholderImage;

    if (photoUrl.startsWith('assets/')) {
      if (imageMap[photoUrl]) return imageMap[photoUrl];
      const jpgUrl = photoUrl.replace('.jpeg', '.jpg');
      if (imageMap[jpgUrl]) return imageMap[jpgUrl];
      const jpegUrl = photoUrl.replace('.jpg', '.jpeg');
      if (imageMap[jpegUrl]) return imageMap[jpegUrl];
      return placeholderImage;
    }

    if (photoUrl.startsWith('http://') || photoUrl.startsWith('https://')) {
      return { uri: photoUrl };
    }

    return placeholderImage;
  }, []);
}
