import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { PHOTO_CHANGED, readPhoto, useMyPhoto } from '../lib/photo.js';
import { useSession } from '../lib/session.jsx';
import { savedTheme, saveTheme } from '../lib/theme.js';
import { LANGUAGES } from '../../../shared/i18n.js';
import Icon from './Icon.jsx';
import PhotoCropper from './PhotoCropper.jsx';

const initials = (name = '') => name.replace(/^(Mr|Mrs|Ms|Dr)\.?\s*/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/** The signed-in person in the top bar: their picture, and a menu for their account. */
export default function ProfileMenu({ roleLabel, onChangePassword, onSystemHealth = null }) {
  const { user, token, signOut, refresh } = useSession();
  const t = useT();
  const [open, setOpen] = useState(false);
  const photo = useMyPhoto();
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [theme, setTheme] = useState(savedTheme);
  const chooseTheme = (next) => {
    setTheme(next);
    saveTheme(next);
  };
  const root = useRef(null);
  const file = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => { if (!root.current?.contains(e.target)) setOpen(false); };
    const escape = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const save = async (next) => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/me/photo', { token, method: 'PUT', body: { photo: next } });
      window.dispatchEvent(new Event(PHOTO_CHANGED));
      setPicked(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const choose = async (e) => {
    const chosen = e.target.files[0];
    e.target.value = '';
    if (!chosen) return;
    setError(null);
    try {
      setPicked(await readPhoto(chosen)); // placed in the round frame before saving
    } catch (err) {
      setError(err.message || 'That picture could not be read');
    }
  };
  const setLanguage = (language) => api('/api/me/language', { token, method: 'PUT', body: { language } }).then(refresh).catch((err) => setError(err.message));

  const picture = (size) => (
    <span className={`profile-pic ${size}`} aria-hidden="true">
      {photo ? <img src={photo} alt="" /> : initials(user.name)}
    </span>
  );

  return (
    <div className={`profile${open ? ' is-open' : ''}`} ref={root}>
      <button type="button" className="profile-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`${user.name}, account menu`} onClick={() => setOpen((v) => !v)}>
        {picture('small')}
        <span className="user-meta"><b>{user.name}</b><small>{roleLabel}</small></span>
        <Icon name="down" size={15} className="profile-chevron" />
      </button>
      {open && (
        <div className="profile-menu" role="menu">
          <div className="profile-head">
            <button type="button" className="profile-pic-btn" aria-label={t(photo ? 'Change photo' : 'Add photo')} disabled={busy} onClick={() => file.current.click()}>
              {picture('large')}
              <span className="profile-pic-edit"><Icon name="edit" size={13} /></span>
            </button>
            <span className="profile-who">
              <b>{user.name}</b>
              <small>{roleLabel}</small>
              <small>@{user.username}</small>
            </span>
          </div>
          <div className="profile-photo-actions">
            <button type="button" role="menuitem" disabled={busy} onClick={() => file.current.click()}>{t(photo ? 'Change photo' : 'Add photo')}</button>
            {photo && <button type="button" role="menuitem" className="quiet" disabled={busy} onClick={() => save(null)}>{t('Remove photo')}</button>}
          </div>
          <input ref={file} type="file" accept="image/*" hidden onChange={choose} />
          {error && <p className="profile-error" role="alert">{error}</p>}
          <div className="profile-language">
              <span><span className="pref-icon"><Icon name="edit" size={15} /></span> {t('Language')}</span>
              <span className="profile-switch">
                {LANGUAGES.map((l) => (
                  <button key={l.value} type="button" aria-pressed={user.language === l.value} className={user.language === l.value ? 'on' : ''} onClick={() => setLanguage(l.value)}>{l.label}</button>
                ))}
              </span>
            </div>
          <div className="profile-language">
            <span><span className="pref-icon"><Icon name="sun" size={15} /></span> {t('Theme')}</span>
            <span className="profile-switch" role="group" aria-label={t('Theme')}>
              {[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([value, label]) => (
                <button key={value} type="button" aria-pressed={theme === value} className={theme === value ? 'on' : ''} onClick={() => chooseTheme(value)}>{t(label)}</button>
              ))}
            </span>
          </div>
          {onSystemHealth && <button type="button" role="menuitem" className="profile-item" onClick={() => { setOpen(false); onSystemHealth(); }}><Icon name="shield" size={16} /> {t('System health')}</button>}
          <button type="button" role="menuitem" className="profile-item" onClick={() => { setOpen(false); onChangePassword(); }}><Icon name="lock" size={16} /> {t('Change password')}</button>
          <button type="button" role="menuitem" className="profile-item danger" onClick={() => { signOut(); window.location.hash = '#/'; }}><Icon name="logout" size={16} /> {t('Sign out')}</button>
        </div>
      )}
      {/* Kept outside the menu: clicking in the dialog closes the menu, not the dialog. */}
      {picked && <PhotoCropper bitmap={picked} busy={busy} error={error} onSave={save} onCancel={() => { setPicked(null); setError(null); }} />}
    </div>
  );
}
