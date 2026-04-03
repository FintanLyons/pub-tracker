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
      '@react-native-google-signin/google-signin',
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
    android: {
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
      ],
    },
    web: {
      favicon: './assets/logo.png',
    },
    extra: {
      eas: {
        projectId: 'cd970f03-6d5e-4e0d-bd04-ffc7afa5a1ed',
      },
    },
  },
};
