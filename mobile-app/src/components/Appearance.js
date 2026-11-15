import { useEffect, useState } from 'react';
import { LANGUAGES } from '../../../shared/i18n.js';
import { api } from '../lib/api.js';
import { useT } from '../lib/offline.js';
import { useSession } from '../lib/session.js';
import { getJSON, setJSON } from '../lib/storage.js';
import { THEME_KEY } from '../theme.js';
import { ListRow, ViewList } from './adminkit.js';
import { Segmented } from './ui.js';

/**
 * Language and theme, as a "Preferences" list (Settings, the driver, parents).
 * The theme follows the phone unless set here; a change applies the next time
 * the app opens.
 */
export default function Appearance({ label = 'Preferences' }) {
  const { user, token, refresh } = useSession();
  const t = useT();
  const [theme, setTheme] = useState(null);
  const [changed, setChanged] = useState(false);
  useEffect(() => { getJSON(THEME_KEY, 'system').then((v) => setTheme(v === 'light' || v === 'dark' ? v : 'system')); }, []);
  const chooseTheme = (v) => {
    setTheme(v);
    setChanged(true);
    setJSON(THEME_KEY, v);
  };
  const chooseLanguage = (language) => api('/api/me/language', { token, method: 'PUT', body: { language } }).then(refresh).catch(() => {});
  return (
    <ViewList label={label}>
      <ListRow icon="edit" title="Language" below={<Segmented value={user?.language ?? 'en'} onChange={chooseLanguage} options={LANGUAGES} />} />
      <ListRow
        icon="sun"
        title="Theme"
        summary={changed ? 'Close and reopen the app to see the change.' : 'Follows your phone unless you pick one.'}
        below={theme ? <Segmented value={theme} onChange={chooseTheme} options={[{ value: 'system', label: t('System') }, { value: 'light', label: t('Light') }, { value: 'dark', label: t('Dark') }]} /> : null}
      />
    </ViewList>
  );
}
