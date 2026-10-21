import fs from 'node:fs';

// Adds Google Maps and Firebase (Android push) on top of app.json. The Maps keys
// come from .env.local (git-ignored), which Expo loads before reading this file:
//   GOOGLE_MAPS_ANDROID_API_KEY=...   (Maps SDK for Android)
//   GOOGLE_MAPS_IOS_API_KEY=...       (Maps SDK for iOS, optional)
// Expo Go on Android needs neither: it ships its own key. They are needed for
// development and store builds (eas build / npx expo run:android).
export default ({ config }) => {
  // An installed build needs a Maps key: without one, Google's Maps SDK stops the app
  // when a map opens. The placeholder keeps it running (maps show a blank background)
  // until a real key is added.
  const androidGoogleMapsApiKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY || 'ADD_GOOGLE_MAPS_ANDROID_API_KEY';
  const iosGoogleMapsApiKey = process.env.GOOGLE_MAPS_IOS_API_KEY;
  return {
    ...config,
    // Android push notifications go through Firebase Cloud Messaging: download
    // google-services.json from the Firebase console into mobile-app/ and rebuild.
    android: fs.existsSync('./google-services.json')
      ? { ...config.android, googleServicesFile: './google-services.json' }
      : config.android,
    plugins: [
      ...(config.plugins ?? []),
      ['react-native-maps', { androidGoogleMapsApiKey, iosGoogleMapsApiKey }],
      // The backend is usually reached as plain http://<computer>:4000 on the local
      // network, which Android blocks in installed builds unless allowed. Set
      // ALLOW_HTTP=0 for a build that only talks to an https server.
      ['expo-build-properties', { android: { usesCleartextTraffic: process.env.ALLOW_HTTP !== '0' } }],
    ],
    extra: {
      ...config.extra,
      // Without a key, iOS keeps Apple Maps (the Google provider would show a blank map).
      googleMapsIos: Boolean(iosGoogleMapsApiKey),
    },
  };
};
