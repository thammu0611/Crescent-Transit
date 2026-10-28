// A safety net for the whole app. An error while starting or drawing a screen
// no longer closes the app: it shows what went wrong (so it can be reported)
// with a button to start again. Uses only plain React Native views, so it works
// even when fonts or other modules failed to load.
import { reloadAppAsync } from 'expo';
import Constants from 'expo-constants';
import * as SplashScreen from 'expo-splash-screen';
import { Component, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

let current = null;
const listeners = new Set();
const report = (error) => {
  current = error instanceof Error ? error : new Error(String(error));
  listeners.forEach((l) => l(current));
};

/** Catch errors that would otherwise close the app. Call before anything else loads. */
export function installCrashGuard() {
  const ErrorUtils = global.ErrorUtils;
  if (!ErrorUtils?.setGlobalHandler) return;
  const previous = ErrorUtils.getGlobalHandler?.();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    if (isFatal) report(error);
    else previous?.(error, isFatal);
  });
}

class Boundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { report(error); }
  render() { return this.state.failed ? null : this.props.children; }
}

function CrashScreen({ error }) {
  // The splash screen may still be up (the app hides it once ready); take it down.
  useEffect(() => { SplashScreen.hideAsync().catch(() => {}); }, []);
  const version = Constants.expoConfig?.version ?? '';
  const stack = String(error?.stack ?? '').split('\n').slice(0, 14).join('\n');
  return (
    <View style={{ flex: 1, backgroundColor: '#1c315e', paddingTop: 64, paddingHorizontal: 20, paddingBottom: 28, gap: 14 }}>
      <Text style={{ color: '#f7bc31', fontSize: 12, letterSpacing: 2, fontWeight: '700' }}>CRESCENT TRANSIT {version}</Text>
      <Text style={{ color: '#fff', fontSize: 24, fontWeight: '700' }}>Something went wrong</Text>
      <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 15, lineHeight: 22 }}>
        The app hit a problem while starting. Please take a screenshot of this screen and send it to the transport office, then tap Try again.
      </Text>
      <ScrollView style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 14 }} contentContainerStyle={{ padding: 14 }}>
        <Text selectable style={{ color: '#ffd56b', fontSize: 14, fontWeight: '700', marginBottom: 8 }}>{error?.name}: {error?.message}</Text>
        <Text selectable style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11, lineHeight: 16 }}>{stack}</Text>
      </ScrollView>
      <Pressable accessibilityRole="button" onPress={() => reloadAppAsync?.().catch(() => {})} style={{ backgroundColor: '#f7bc31', borderRadius: 14, paddingVertical: 14, alignItems: 'center' }}>
        <Text style={{ color: '#1c315e', fontSize: 16, fontWeight: '700' }}>Try again</Text>
      </Pressable>
    </View>
  );
}

/** The registered root: the app inside the safety net, or the error screen. */
export function makeRoot(App, loadError) {
  if (loadError) report(loadError);
  return function Root() {
    const [error, setError] = useState(current);
    useEffect(() => {
      listeners.add(setError);
      return () => listeners.delete(setError);
    }, []);
    if (error || !App) return <CrashScreen error={error ?? new Error('The app could not load.')} />;
    return <Boundary><App /></Boundary>;
  };
}
