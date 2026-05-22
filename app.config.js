import fs from 'fs';
import path from 'path';
import { APP_DISPLAY_NAME } from './constants/app.js';
import { EAS_PROJECT_ID } from './constants/easProject.js';

// Android push (FCM): add Firebase Android app with package = android.package, download
// google-services.json to project root (gitignored — do not commit). See Expo FCM doc:
// https://docs.expo.dev/push-notifications/fcm-credentials/
const googleServicesJsonPath = path.join(process.cwd(), 'google-services.json');
const googleServicesFile = fs.existsSync(googleServicesJsonPath)
  ? './google-services.json'
  : undefined;

// App Store / Play Store identifiers — set EXPO_PUBLIC_IOS_BUNDLE_ID and
// EXPO_PUBLIC_ANDROID_PACKAGE in .env (same value is fine for both stores).
const iosBundleId =
  process.env.EXPO_PUBLIC_IOS_BUNDLE_ID || 'com.fintanlyons.pubtracker';
const androidPackage =
  process.env.EXPO_PUBLIC_ANDROID_PACKAGE || 'com.fintanlyons.pubtracker';

/** iOS reversed client ID for Info.plist URL scheme (required by @react-native-google-signin plugin). */
function googleIosUrlSchemeFromClientId(clientId) {
  if (!clientId) return null;
  const prefix = clientId.replace(/\.apps\.googleusercontent\.com$/i, '');
  if (!prefix || prefix === clientId) return null;
  return `com.googleusercontent.apps.${prefix}`;
}

const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
const googleIosUrlScheme = googleIosUrlSchemeFromClientId(googleIosClientId);

export default {
  expo: {
    name: APP_DISPLAY_NAME,
    slug: 'pub-tracker',
    version: '1.0.1',
    orientation: 'portrait',
    // Charcoal + amber visited pub pin (1024); Android uses adaptive layers below.
    icon: './assets/app-icon.png',
    userInterfaceStyle: 'light',
    newArchEnabled: true,
    splash: {
      image: './assets/adaptive-icon-foreground.png',
      resizeMode: 'contain',
      backgroundColor: '#1C1C1C',
    },
    plugins: [
      'expo-apple-authentication',
      '@maplibre/maplibre-react-native',
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission:
            `Allow ${APP_DISPLAY_NAME} to access your location to show nearby pubs`,
          locationWhenInUsePermission:
            `Allow ${APP_DISPLAY_NAME} to access your location to show nearby pubs`,
        },
      ],
      'expo-mail-composer',
      [
        'expo-image-picker',
        {
          photosPermission: `Allow ${APP_DISPLAY_NAME} to attach photos to pub reports.`,
        },
      ],
      // iosUrlScheme only when EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID is set (EAS production build).
      // Without it, use the plugin entry with no options so `expo config` / `eas credentials` still work locally.
      googleIosUrlScheme
        ? [
            '@react-native-google-signin/google-signin',
            { iosUrlScheme: googleIosUrlScheme },
          ]
        : '@react-native-google-signin/google-signin',
      [
        'expo-notifications',
        {
          icon: './assets/logo.png',
          color: '#D4A017',
          sounds: [],
        },
      ],
    ],
    ios: {
      supportsTablet: true,
      usesAppleSignIn: true,
      bundleIdentifier: iosBundleId,
      infoPlist: {
        NSLocationWhenInUseUsageDescription: `${APP_DISPLAY_NAME} needs your location to show pubs near you.`,
        NSLocationAlwaysUsageDescription: `${APP_DISPLAY_NAME} needs your location to show pubs near you.`,
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    androidNavigationBar: {
      // Native theme (works with edge-to-edge); avoids expo-navigation-bar setBackgroundColorAsync warning.
      backgroundColor: '#1C1C1C',
      barStyle: 'light-content',
    },
    android: {
      ...(googleServicesFile ? { googleServicesFile } : {}),
      softwareKeyboardLayoutMode: 'resize',
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon-foreground.png',
        backgroundColor: '#1C1C1C',
      },
      icon: './assets/app-icon.png',
      package: androidPackage,
      permissions: [
        'ACCESS_COARSE_LOCATION',
        'ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.POST_NOTIFICATIONS',
      ],
    },
    web: {
      favicon: './assets/logo.png',
    },
    extra: {
      eas: {
        projectId: EAS_PROJECT_ID,
      },
    },
  },
};
