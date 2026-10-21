// Small taps of vibration that make presses feel physical. Silent on the web and
// wherever the phone has no haptics; never throws.
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const on = Platform.OS === 'ios' || Platform.OS === 'android';

/** Switching tabs or segments. */
export const tickSelect = () => { if (on) Haptics.selectionAsync().catch(() => {}); };

/** Pressing a button. */
export const tickPress = () => { if (on) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); };
