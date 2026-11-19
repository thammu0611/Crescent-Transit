import QRCode from 'qrcode';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { date } from '../../lib/format.js';
import { useT } from '../../lib/i18n.js';
import { PHOTO_CHANGED } from '../../lib/photo.js';
import { useSession } from '../../lib/session.jsx';
import { useNow } from '../../lib/useNow.js';
import BrandMark from '../../components/BrandMark.jsx';
import Icon from '../../components/Icon.jsx';
import { Avatar } from '../../components/adminkit.jsx';
import { Badge, ErrorText, Page } from '../../components/ui.jsx';

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

  const left = pass ? Math.max(0, Math.round((new Date(pass.expiresAt).getTime() - now) / 1000)) : 0;
  const [tone, label] = STATUS[pass?.status] ?? ['offline', '…'];
  return (
    <Page eyebrow="Student" title={t('Bus pass')}>
      <ErrorText>{error}</ErrorText>
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
              <div><dt>{t('Valid till')}</dt><dd>{pass.validTo ? date(pass.validTo) : t('No expiry')}</dd></div>
            </dl>
            {/* An expired pass says so and leads straight to renewing it. */}
            {pass.status === 'EXPIRED' && (
              <div className="pass-renew" role="status">
                <span><b>{t('Your pass has expired')}</b><small>{t('Renew to use the bus and live tracking again.')}</small></span>
                <a className="btn red inline" href="#/pay">{t('Renew')} <Icon name="arrow" size={15} /></a>
              </div>
            )}
          </section>
          <section className="panel pass-code">
            <p className="pass-hint">{t('Show this code to the driver')}</p>
            {qr ? <img className="pass-qr" src={qr} alt="Your bus pass QR code" /> : <div className="skeleton-block" />}
            <div className="pass-meter" aria-hidden="true"><i style={{ width: `${(left / 90) * 100}%` }} /></div>
            <small className="muted tabular">{t('New code in')} {left} {t('seconds')}</small>
          </section>
        </div>
      )}
    </Page>
  );
}
