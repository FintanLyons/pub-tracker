import fs from 'fs';
import path from 'path';
import { EAS_PROJECT_ID } from './constants/easProject.js';

// Android push (FCM): add Firebase Android app with package = android.package, download
// google-services.json to project root. See https://docs.expo.dev/push-notifications/fcm-credentials/
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

export default {
  expo: {
    name: 'Pub Tracker',
    slug: 'pub-tracker',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/pub_icon.png',
    userInterfaceStyle: 'light',
    newArchEnabled: true,
    splash: {
      image: './assets/pub_icon.png',
      resizeMode: 'contain',
      backgroundColor: '#F7F7F7',
    },
    plugins: [
      '@maplibre/maplibre-react-native',
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission:
            'Allow Pub Tracker to access your location to show nearby pubs',
          locationWhenInUsePermission:
            'Allow Pub Tracker to access your location to show nearby pubs',
        },
      ],
      'expo-mail-composer',
      [
        'expo-image-picker',
        {
          photosPermission:
            'Allow Pub Tracker to attach photos to pub reports.',
        },
      ],
      '@react-native-google-signin/google-signin',
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
      bundleIdentifier: iosBundleId,
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          'This app needs access to location to show pubs near you.',
        NSLocationAlwaysUsageDescription:
          'This app needs access to location to show pubs near you.',
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
        foregroundImage: './assets/logo.png',
        backgroundColor: '#ffffff',
      },
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
