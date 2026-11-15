import { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n.js';
import { cropPhoto } from '../lib/photo.js';
import Icon from './Icon.jsx';
import { Modal } from './ui.jsx';

const FRAME = 260;

/**
 * Place a new profile picture in the round frame before it is saved: drag to
 * move it, use the slider (or the mouse wheel) to zoom. The picture always
 * covers the whole frame, so no empty corners are saved.
 */
export default function PhotoCropper({ bitmap, busy, error, onSave, onCancel }) {
  const t = useT();
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [url, setUrl] = useState(null);
  const drag = useRef(null);

  // Show the picture from the bitmap.
  useEffect(() => {
    const c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    c.getContext('2d').drawImage(bitmap, 0, 0);
    setUrl(c.toDataURL('image/jpeg', 0.9));
  }, [bitmap]);

  const short = Math.min(bitmap.width, bitmap.height);
  const limit = (z) => ({ x: (bitmap.width * z / short - 1) / 2, y: (bitmap.height * z / short - 1) / 2 });
  const clamp = (p, z = zoom) => {
    const l = limit(z);
    return { x: Math.max(-l.x, Math.min(l.x, p.x)), y: Math.max(-l.y, Math.min(l.y, p.y)) };
  };
  const setZoomTo = (z) => {
    const next = Math.max(1, Math.min(4, z));
    setZoom(next);
    setPos((p) => clamp(p, next));
  };

  const scale = (FRAME * zoom) / short;
  const down = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, start: pos };
  };
  const move = (e) => {
    if (!drag.current) return;
    const { sx, sy, start } = drag.current;
    setPos(clamp({ x: start.x + (e.clientX - sx) / FRAME, y: start.y + (e.clientY - sy) / FRAME }));
  };
  const up = () => { drag.current = null; };
  const key = (e) => {
    const step = { ArrowLeft: [-0.03, 0], ArrowRight: [0.03, 0], ArrowUp: [0, -0.03], ArrowDown: [0, 0.03] }[e.key];
    if (!step) return;
    e.preventDefault();
    setPos((p) => clamp({ x: p.x + step[0], y: p.y + step[1] }));
  };

  return (
    <Modal title={t('Place your photo')} onClose={busy ? undefined : onCancel} width={400}>
      <p className="muted crop-hint">{t('Drag to move it, and zoom so your face fits the circle.')}</p>
      <div
        className="crop-frame"
        style={{ width: FRAME, height: FRAME }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onWheel={(e) => setZoomTo(zoom - e.deltaY / 600)}
        onKeyDown={key}
        tabIndex={0}
        role="img"
        aria-label={t('Photo position. Use the arrow keys to move it.')}
      >
        {url && (
          <img
            src={url}
            alt=""
            draggable={false}
            style={{
              width: bitmap.width * scale,
              height: bitmap.height * scale,
              transform: `translate(calc(-50% + ${pos.x * FRAME}px), calc(-50% + ${pos.y * FRAME}px))`,
            }}
          />
        )}
        <span className="crop-ring" aria-hidden="true" />
      </div>
      <label className="crop-zoom">
        <Icon name="search" size={16} />
        <input type="range" min="1" max="4" step="0.01" value={zoom} onChange={(e) => setZoomTo(Number(e.target.value))} aria-label={t('Zoom')} />
        <button type="button" className="btn ghost inline" onClick={() => { setZoom(1); setPos({ x: 0, y: 0 }); }}>{t('Reset')}</button>
      </label>
      {error && <p className="profile-error" role="alert">{error}</p>}
      <div className="btn-row crop-actions">
        <button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>{t('Cancel')}</button>
        <button type="button" className="btn dark" disabled={busy || !url} onClick={() => onSave(cropPhoto(bitmap, { zoom, ...pos }))}>{busy ? t('Saving…') : t('Save photo')}</button>
      </div>
    </Modal>
  );
}
