import { useCallback } from 'react';
import { translate } from '../../../shared/i18n.js';
import { api } from './api.js';
import { useSession } from './session.js';
import { getJSON, setJSON } from './storage.js';

/**
 * Public route data, kept on the phone: with no signal the last copy is used,
 * so timetables and stops still open. Live positions are never saved.
 */
export async function routeData(path) {
  const key = `offline:${path}`;
  try {
    const data = await api(path);
    setJSON(key, data);
    return data;
  } catch (err) {
    if (!(err instanceof TypeError)) throw err; // only "no network" falls back
    const saved = await getJSON(key);
    if (saved == null) throw err;
    return saved;
  }
}

/** t('Home') in the signed-in user's language. */
export function useT() {
  const { user } = useSession();
  const language = user?.language ?? 'en';
  return useCallback((english) => translate(language, english), [language]);
}
