import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'react-native';

/** Longest edge of an uploaded report photo — plenty for a pub photo, ~300–600 KB as JPEG. */
const MAX_EDGE = 1600;

const JPEG_OPTIONS = {
  compress: 0.8,
  format: ImageManipulator.SaveFormat.JPEG,
};

function getImageSize(uri) {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

/**
 * Shrink a picked photo for upload: longest edge ≤ MAX_EDGE, re-encoded as JPEG
 * (this also drops EXIF data such as the GPS location). Falls back to the original
 * on failure; the server still enforces its size limit.
 */
export async function prepareReportPhotoForUpload(uri) {
  try {
    const { width, height } = await getImageSize(uri);
    const actions =
      Math.max(width, height) > MAX_EDGE
        ? [{ resize: width >= height ? { width: MAX_EDGE } : { height: MAX_EDGE } }]
        : [];
    const out = await ImageManipulator.manipulateAsync(uri, actions, JPEG_OPTIONS);
    return out.uri;
  } catch (e) {
    console.warn('reportImagePrep: using original photo', e?.message ?? e);
    return uri;
  }
}
