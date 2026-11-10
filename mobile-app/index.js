import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerRootComponent } from 'expo';
import * as SplashScreen from 'expo-splash-screen';
import { createElement, useEffect, useState } from 'react';
import { Appearance as DeviceTheme } from 'react-native';

import { installCrashGuard, makeRoot } from './src/CrashGuard';
// Defines the background GPS task; Android may start the app just to run it.
import './src/lib/driverGps.js';
import { THEME_KEY, applyDarkPalette } from './src/theme.js';

// The safety net goes in first, so even an error while the app's own modules
// load shows an error screen instead of closing the app.
installCrashGuard();
SplashScreen.preventAutoHideAsync().catch(() => {});

// Dark mode is read before any screen loads: styles are fixed when a file loads,
// so the palette has to be right by then.
function Boot() {
  const [Root, setRoot] = useState(null);
  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then((v) => {
      // 'light' or 'dark' when the person picked one; otherwise follow the phone.
      const choice = v ? JSON.parse(v) : 'system';
      const dark = choice === 'dark' || (choice !== 'light' && DeviceTheme.getColorScheme() === 'dark');
      if (dark) applyDarkPalette();
    }).catch(() => {}).finally(() => {
      let App = null;
      let loadError = null;
      try {
        App = require('./App').default;
      } catch (err) {
        loadError = err;
      }
      setRoot(() => makeRoot(App, loadError));
    });
  }, []);
  return Root ? createElement(Root) : null;
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(Boot);
