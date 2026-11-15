import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.js';
import { Avatar } from './ui.js';

// One request for the signed-in person's photo, shared by every avatar on screen.
let cached = { token: null, photo: null, loading: null, at: 0 };
const listeners = new Set();

function fetchPhoto(token, force) {
  if (!token) return Promise.resolve(null);
  const fresh = cached.token === token && Date.now() - cached.at < 5 * 60000;
  if (!force && fresh && cached.loading) return cached.loading;
  if (cached.token !== token) cached = { token, photo: null, loading: null, at: 0 };
  cached.at = Date.now();
  cached.loading = api('/api/me/photo', { token })
    .then((r) => { cached.photo = r.photo ?? null; listeners.forEach((f) => f(cached.photo)); return cached.photo; })
    .catch(() => cached.photo);
  return cached.loading;
}

/** Ask every avatar to fetch the photo again (after it was changed or removed). */
export function photoChanged(token) {
  return fetchPhoto(token, true);
}

/** The signed-in person's photo (set on the website or the bus pass), or null. */
export function useMyPhoto() {
  const { token } = useSession();
  const [photo, setPhoto] = useState(cached.token === token ? cached.photo : null);
  useEffect(() => {
    listeners.add(setPhoto);
    fetchPhoto(token).then(setPhoto);
    return () => { listeners.delete(setPhoto); };
  }, [token]);
  return photo;
}

/** The signed-in person's avatar: their photo, filling the circle, or their initials. */
export default function MyAvatar({ size = 44, light }) {
  const { user } = useSession();
  const photo = useMyPhoto();
  return <Avatar name={user?.name ?? ''} size={size} light={light} photo={photo} />;
}
