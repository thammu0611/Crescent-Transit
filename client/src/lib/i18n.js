import { useCallback } from 'react';
import { translate } from '../../../shared/i18n.js';
import { useSession } from './session.jsx';

/** t('Home') in the signed-in user's language. */
export function useT() {
  const { user } = useSession();
  const language = user?.language ?? 'en';
  return useCallback((english) => translate(language, english), [language]);
}
