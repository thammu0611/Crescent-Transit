import { useEffect, useState } from 'react';
import { api } from './api.js';
import { useSession } from './session.jsx';

export const PHOTO_CHANGED = 'ubts:photo-changed';
const OUT = 320; // stored picture: a 320 px square JPEG, small enough to store and quick to show

/** Read a chosen file into an image the cropper can draw. */
export async function readPhoto(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('Choose a picture file');
  return createImageBitmap(file);
}

/**
 * The picture as the round frame shows it: `zoom` 1 fits the shorter side,
 * `x`/`y` move the picture in frame-widths (0 = centred).
 */
export function cropPhoto(bitmap, { zoom = 1, x = 0, y = 0 } = {}) {
  const side = Math.min(bitmap.width, bitmap.height) / zoom;
  const cx = bitmap.width / 2 - x * side;
  const cy = bitmap.height / 2 - y * side;
  const canvas = document.createElement('canvas');
  canvas.width = OUT;
  canvas.height = OUT;
  const g = canvas.getContext('2d');
  g.fillStyle = '#1C315E';
  g.fillRect(0, 0, OUT, OUT);
  g.drawImage(bitmap, cx - side / 2, cy - side / 2, side, side, 0, 0, OUT, OUT);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/** Centre square crop, for callers that skip the cropper. */
export async function squarePhoto(file) {
  return cropPhoto(await readPhoto(file));
}

// One request for the signed-in person's picture, shared by every avatar on the page.
let cached = { token: null, photo: null, loading: null };
function fetchPhoto(token, force) {
  if (!token) return Promise.resolve(null);
  if (!force && cached.token === token && cached.loading) return cached.loading;
  cached = { token, photo: cached.token === token ? cached.photo : null, loading: null };
  cached.loading = api('/api/me/photo', { token }).then((r) => (cached.photo = r.photo ?? null)).catch(() => cached.photo);
  return cached.loading;
}

/** The signed-in person's profile picture (a data URL) or null; updates everywhere when it changes. */
export function useMyPhoto() {
  const { token } = useSession();
  const [photo, setPhoto] = useState(cached.token === token ? cached.photo : null);
  useEffect(() => {
    let live = true;
    fetchPhoto(token).then((p) => live && setPhoto(p));
    const changed = () => fetchPhoto(token, true).then((p) => live && setPhoto(p));
    window.addEventListener(PHOTO_CHANGED, changed);
    return () => { live = false; window.removeEventListener(PHOTO_CHANGED, changed); };
  }, [token]);
  return photo;
}
