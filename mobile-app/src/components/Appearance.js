import { useEffect, useState } from 'react';
import { LANGUAGES } from '../../../shared/i18n.js';
import { api } from '../lib/api.js';
import { useT } from '../lib/offline.js';
import { useSession } from '../lib/session.js';
import { getJSON, setJSON } from '../lib/storage.js';
import { THEME_KEY } from '../theme.js';
import { Notice, Panel, Segmented, Txt } from './ui.js';

/** Language and theme. The theme follows the phone unless set here; a change applies the next time the app opens. */
export default function Appearance() {
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
    <Panel title="Language" icon="sparkle">
      <Segmented value={user?.language ?? 'en'} onChange={chooseLanguage} options={LANGUAGES} />
      <Txt bold>{t('Theme')}</Txt>
      {theme ? <Segmented value={theme} onChange={chooseTheme} options={[{ value: 'system', label: t('System') }, { value: 'light', label: t('Light') }, { value: 'dark', label: t('Dark') }]} /> : null}
      {changed ? <Notice>Close and reopen the app to see the change.</Notice> : null}
    </Panel>
  );
}
