import AsyncStorage from '@react-native-async-storage/async-storage';

// Phone storage for per-device conveniences (the web app's localStorage).
export async function getJSON(key, fallback = null) {
  try {
    const v = await AsyncStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export async function setJSON(key, value) {
  try {
    if (value == null) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the value lasts until the app closes.
  }
}
