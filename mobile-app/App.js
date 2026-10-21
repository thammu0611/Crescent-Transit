import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PromptProvider } from './src/components/ui.js';
import { loadServerUrl } from './src/config.js';
import { SessionProvider } from './src/lib/session.js';
import RootNavigator, { navigationRef } from './src/navigation.js';
import { C } from './src/theme.js';

// Keep the branded splash up until the fonts and saved server address are ready.
SplashScreen.preventAutoHideAsync().catch(() => {});

// Only the weights the app uses (the package indexes would bundle every cut):
// Inter for the interface, Poppins for large headings, Montserrat for the app name and navigation.
const FONTS = {
  Inter_400Regular: require('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'),
  Inter_500Medium: require('@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf'),
  Inter_600SemiBold: require('@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf'),
  Inter_700Bold: require('@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf'),
  Poppins_600SemiBold: require('@expo-google-fonts/poppins/600SemiBold/Poppins_600SemiBold.ttf'),
  Poppins_700Bold: require('@expo-google-fonts/poppins/700Bold/Poppins_700Bold.ttf'),
  // Montserrat (crescent.education's heading face): the app name and the navigation, as on the web.
  Montserrat_600SemiBold: require('@expo-google-fonts/montserrat/600SemiBold/Montserrat_600SemiBold.ttf'),
  Montserrat_700Bold: require('@expo-google-fonts/montserrat/700Bold/Montserrat_700Bold.ttf'),
  Montserrat_800ExtraBold: require('@expo-google-fonts/montserrat/800ExtraBold/Montserrat_800ExtraBold.ttf'),
  // Serif headings kept for older screens.
  PlayfairDisplay_600SemiBold: require('@expo-google-fonts/playfair-display/600SemiBold/PlayfairDisplay_600SemiBold.ttf'),
  PlayfairDisplay_700Bold: require('@expo-google-fonts/playfair-display/700Bold/PlayfairDisplay_700Bold.ttf'),
};

const theme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, primary: C.navy, background: C.bg, card: C.bg, text: C.ink, border: C.line } };

export default function App() {
  const [fontsLoaded, fontError] = useFonts(FONTS);
  // The saved server address must be known before the first request.
  const [configured, setConfigured] = useState(false);
  useEffect(() => { loadServerUrl().finally(() => setConfigured(true)); }, []);

  // A font that fails to load falls back to the system font rather than blocking the app.
  const ready = configured && (fontsLoaded || Boolean(fontError));
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SessionProvider>
        <PromptProvider>
          <NavigationContainer ref={navigationRef} theme={theme}>
            <RootNavigator />
          </NavigationContainer>
        </PromptProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
