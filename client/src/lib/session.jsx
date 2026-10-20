import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from './api.js';

const KEY = 'ubts.session';
const SessionContext = createContext(null);

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? null;
  } catch {
    return null;
  }
}

function write(session) {
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify(session));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked (private window): the session lasts until the tab closes.
  }
}

/** The signed-in user, their token and (for students) their entitlement. */
export function SessionProvider({ children }) {
  const [session, setSession] = useState(read);
  const [entitlement, setEntitlement] = useState(null);

  const signIn = useCallback((s) => {
    write(s);
    setSession(s);
  }, []);
  const signOut = useCallback(() => {
    write(null);
    setSession(null);
    setEntitlement(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!session?.token) return;
    try {
      const me = await api('/api/me', { token: session.token });
      const next = { ...session, user: me.user };
      write(next);
      setSession(next);
      setEntitlement(me.entitlement ?? null);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) signOut();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ token: session?.token ?? null, user: session?.user ?? null, entitlement, signIn, signOut, refresh }),
    [session, entitlement, signIn, signOut, refresh],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
