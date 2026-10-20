import * as SecureStore from 'expo-secure-store';
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { api, ApiError, closeSocket } from './api.js';
import { unregisterFromPush } from './notify.js';

// The signed-in user and token, kept in the phone's secure storage
// (Keychain / Keystore) instead of the browser's localStorage.
const KEY = 'ubts.session';
const SessionContext = createContext(null);

// Browser preview only: there is no secure storage in a browser.
const web = Platform.OS === 'web';

async function read() {
  try {
    return JSON.parse(web ? window.localStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY)) ?? null;
  } catch {
    return null;
  }
}

async function write(session) {
  try {
    if (web) {
      if (session) window.localStorage.setItem(KEY, JSON.stringify(session));
      else window.localStorage.removeItem(KEY);
    } else if (session) await SecureStore.setItemAsync(KEY, JSON.stringify(session));
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Secure storage unavailable: the session lasts until the app closes.
  }
}

/** The signed-in user, their token and (for students) their entitlement. */
export function SessionProvider({ children }) {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [entitlement, setEntitlement] = useState(null);

  useEffect(() => {
    read().then((s) => {
      setSession(s);
      setReady(true);
    });
  }, []);

  const signIn = useCallback((s) => {
    write(s);
    setSession(s);
  }, []);
  const signOut = useCallback(() => {
    unregisterFromPush(); // this phone stops receiving the account's notifications
    write(null);
    closeSocket();
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
    () => ({ ready, token: session?.token ?? null, user: session?.user ?? null, entitlement, signIn, signOut, refresh }),
    [ready, session, entitlement, signIn, signOut, refresh],
  );
  return createElement(SessionContext.Provider, { value }, children);
}

export const useSession = () => useContext(SessionContext);
