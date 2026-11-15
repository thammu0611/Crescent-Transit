import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { date } from '../../lib/format.js';
import { useT } from '../../lib/i18n.js';
import { PHOTO_CHANGED, readPhoto } from '../../lib/photo.js';
import PhotoCropper from '../../components/PhotoCropper.jsx';
import { useSession } from '../../lib/session.jsx';
import { useNow } from '../../lib/useNow.js';
import BrandMark from '../../components/BrandMark.jsx';
import Icon from '../../components/Icon.jsx';
import { Avatar } from '../../components/adminkit.jsx';
import { Badge, ErrorText, Notice, Page } from '../../components/ui.jsx';

const STATUS = {
  ACTIVE: ['live', 'Active'],
  FREE: ['live', 'Active'],
  GRACE: ['delayed', 'In grace period'],
  EXPIRED: ['danger', 'Expired'],
};

/** The student's digital bus pass. The QR code changes every 90 seconds. */
export default function BusPass() {
  const { token } = useSession();
  const t = useT();
  const now = useNow(1000);
  const [pass, setPass] = useState(null);
  const [qr, setQr] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const file = useRef(null);

  const load = useCallback(async () => {
    try {
      const p = await api('/api/pass', { token });
      setPass(p);
      setQr(await QRCode.toDataURL(p.code, { width: 320, margin: 1, errorCorrectionLevel: 'L', color: { dark: '#142548', light: '#ffffff' } }));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [token]);

  useEffect(() => {
    load();
    window.addEventListener(PHOTO_CHANGED, load);
    return () => window.removeEventListener(PHOTO_CHANGED, load);
  }, [load]);
  // A fresh code before the shown one runs out, while the screen stays open.
  useEffect(() => {
    if (!pass) return undefined;
    const id = setTimeout(load, pass.refreshInS * 1000);
    return () => clearTimeout(id);
  }, [pass, load]);

  // A chosen picture is placed in the round frame first, then saved.
  const [picked, setPicked] = useState(null);
  const [saving, setSaving] = useState(false);
  const choose = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try { setError(null); setPicked(await readPhoto(file)); } catch (err) { setError(err.message); }
  };
  const savePhoto = async (photo) => {
    setSaving(true);
    try {
      await api('/api/pass/photo', { token, method: 'PUT', body: { photo } });
      setPicked(null);
      setMessage('Photo saved.');
      window.dispatchEvent(new Event(PHOTO_CHANGED));
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    await api('/api/pass/photo', { token, method: 'PUT', body: { photo: null } }).catch((err) => setError(err.message));
    window.dispatchEvent(new Event(PHOTO_CHANGED));
    load();
  };

  const left = pass ? Math.max(0, Math.round((new Date(pass.expiresAt).getTime() - now) / 1000)) : 0;
  const [tone, label] = STATUS[pass?.status] ?? ['offline', '…'];
  return (
    <Page eyebrow="Student" title={t('Bus pass')}>
      <ErrorText>{error}</ErrorText>
      <Notice>{message}</Notice>
      {picked && <PhotoCropper bitmap={picked} busy={saving} error={error} onSave={savePhoto} onCancel={() => setPicked(null)} />}
      {pass == null ? <div className="skeleton-block" /> : (
        <div className="pass-layout">
          <section className="pass-card" aria-label="Digital bus pass">
            <header className="pass-top">
              <BrandMark size={40} />
              <span className="pass-brand"><b>Crescent Transit</b><small>{t('Bus pass')}</small></span>
              <Badge tone={tone}>{t(label)}</Badge>
            </header>
            <div className="pass-holder">
              {pass.photo ? <img className="pass-photo" src={pass.photo} alt="" /> : <Avatar name={pass.name} size={76} />}
              <span className="pass-who">
                <b>{pass.name}</b>
                <small>{[pass.registerNo, pass.department].filter(Boolean).join(' · ') || 'Student'}</small>
              </span>
            </div>
            <dl className="pass-facts">
              <div><dt>{t('Route')}</dt><dd>{pass.routeCode ? `${pass.routeCode} · ${pass.routeName}` : '—'}</dd></div>
              <div><dt>{t('Your stop')}</dt><dd>{pass.stopName ?? '—'}</dd></div>
              <div><dt>{t('Valid till')}</dt><dd>{pass.validTo ? date(pass.validTo) : t('Active')}</dd></div>
            </dl>
          </section>
          <section className="panel pass-code">
            <p className="pass-hint">{t('Show this code to the driver')}</p>
            {qr ? <img className="pass-qr" src={qr} alt="Your bus pass QR code" /> : <div className="skeleton-block" />}
            <div className="pass-meter" aria-hidden="true"><i style={{ width: `${(left / 90) * 100}%` }} /></div>
            <small className="muted tabular">{t('New code in')} {left} {t('seconds')}</small>
            <div className="btn-row spaced">
              <button type="button" className="btn ghost inline" onClick={() => file.current.click()}>
                <Icon name="user" size={15} /> {t(pass.photo ? 'Change photo' : 'Add photo')}
              </button>
              {pass.photo && <button type="button" className="btn ghost inline" onClick={remove}>{t('Remove photo')}</button>}
              <input ref={file} type="file" accept="image/*" hidden onChange={choose} />
            </div>
          </section>
        </div>
      )}
    </Page>
  );
}
