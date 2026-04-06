import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

const OUT_SIZE = 512;

const JPEG_OPTIONS = {
  compress: 0.88,
  format: ImageManipulator.SaveFormat.JPEG,
};

/** Shown when media library permission is denied (Profile + Choose username). */
export const AVATAR_LIBRARY_PERMISSION_ALERT = {
  title: 'Photos',
  message:
    'Photo library access is needed for your profile picture. You can enable it in Settings.',
};

async function launchSquareCropPicker() {
  const { status: existing } = await ImagePicker.getMediaLibraryPermissionsAsync();
  let granted = existing === 'granted';
  if (!granted) {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    granted = status === 'granted';
  }
  if (!granted) {
    return { ok: false, reason: 'denied' };
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.85,
  });

  if (result.canceled) return { ok: false, reason: 'cancelled' };
  const asset = result.assets?.[0];
  if (!asset?.uri) return { ok: false, reason: 'cancelled' };
  return { ok: true, uri: asset.uri, width: asset.width, height: asset.height };
}

/**
 * Resize (and only center-crop if the asset is not already square). Output is always OUT_SIZE wide JPEG.
 */
async function normalizeAvatarForUpload(uri, width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;

  if (!w || !h) {
    return ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: OUT_SIZE } }],
      JPEG_OPTIONS,
    );
  }

  if (w === h) {
    return ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: OUT_SIZE } }],
      JPEG_OPTIONS,
    );
  }

  const side = Math.min(w, h);
  const originX = Math.max(0, Math.round((w - side) / 2));
  const originY = Math.max(0, Math.round((h - side) / 2));

  return ImageManipulator.manipulateAsync(
    uri,
    [
      { crop: { originX, originY, width: side, height: side } },
      { resize: { width: OUT_SIZE } },
    ],
    JPEG_OPTIONS,
  );
}

/**
 * Picker (system square crop) → normalize for upload.
 * @returns {Promise<
 *   | { ok: true; uri: string }
 *   | { ok: false; reason: 'denied' | 'cancelled' }
 *   | { ok: false; reason: 'processing'; message: string }
 * >}
 */
export async function pickNormalizedAvatarUri() {
  const res = await launchSquareCropPicker();
  if (!res.ok) return res;
  try {
    const { uri } = await normalizeAvatarForUpload(res.uri, res.width, res.height);
    return { ok: true, uri };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: 'processing', message };
  }
}
