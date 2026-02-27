/**
 * Auth hook for Go backend: login, register, guest, session rehydration.
 * JWT in sessionStorage (hush_jwt); deviceId in localStorage (hush_device_id).
 */

import { useState, useCallback, useEffect } from 'react';
import { fetchWithAuth, uploadKeysAfterAuth } from '../lib/api';

export const JWT_KEY = 'hush_jwt';
export const GUEST_SESSION_KEY = 'hush_guest_session';
const DEVICE_ID_KEY = 'hush_device_id';
const defaultBase = '';

export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID?.() ?? `dev_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

async function postAuth(path, body = null) {
  const url = path.startsWith('http') ? path : `${defaultBase}${path}`;
  const opts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `auth ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function clearSession() {
  sessionStorage.removeItem(JWT_KEY);
}

/**
 * After successful auth: upload Signal keys, then persist token.
 * Token is written to sessionStorage ONLY after key upload succeeds,
 * so a failed upload never leaves a stale JWT behind.
 * @param {{ token: string, user: { id: string } }} data
 * @returns {Promise<{ token: string, user: object }>}
 */
async function finishAuth(data) {
  const { token, user } = data;
  if (!token || !user?.id) throw new Error('invalid auth response');
  const deviceId = getDeviceId();
  await uploadKeysAfterAuth(token, user.id, deviceId);
  sessionStorage.setItem(JWT_KEY, token);
  return { token, user };
}

/**
 * Provides Go-backed auth state and actions.
 * @returns {{
 *   user: object|null,
 *   token: string|null,
 *   isAuthenticated: boolean,
 *   isLoading: boolean,
 *   error: Error|null,
 *   login: (username: string, password: string) => Promise<void>,
 *   register: (username: string, password: string, displayName: string) => Promise<void>,
 *   loginAsGuest: () => Promise<void>,
 *   logout: () => Promise<void>,
 *   clearError: () => void,
 * }}
 */
export function useAuth() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => sessionStorage.getItem(JWT_KEY));
  const [isLoading, setIsLoading] = useState(() => Boolean(sessionStorage.getItem(JWT_KEY)));
  const [error, setError] = useState(null);

  const isAuthenticated = Boolean(token && user);

  const clearError = useCallback(() => setError(null), []);

  /** Shared auth flow: call endpoint, finish auth (keys + persist), update state. */
  const performAuth = useCallback(async (path, body = null) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await postAuth(path, body);
      const result = await finishAuth(data);
      setToken(result.token);
      setUser(result.user);
    } catch (err) {
      setError(err);
      clearSession();
      setToken(null);
      setUser(null);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback(
    (username, password) => performAuth('/api/auth/login', { username, password }),
    [performAuth],
  );

  const register = useCallback(
    (username, password, displayName) => performAuth('/api/auth/register', {
      username,
      password,
      displayName: displayName || username,
    }),
    [performAuth],
  );

  const loginAsGuest = useCallback(
    () => performAuth('/api/auth/guest'),
    [performAuth],
  );

  const logout = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const t = sessionStorage.getItem(JWT_KEY);
      if (t) {
        try {
          await fetchWithAuth(t, '/api/auth/logout', { method: 'POST' });
        } catch {
          // Ignore logout API failure — clear local state regardless
        }
      }
      clearSession();
      setToken(null);
      setUser(null);
    } catch (err) {
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Rehydrate session on mount
  useEffect(() => {
    const stored = sessionStorage.getItem(JWT_KEY);
    if (!stored) {
      setIsLoading(false);
      setUser(null);
      return;
    }

    setIsLoading(true);
    let cancelled = false;

    (async () => {
      try {
        const res = await fetchWithAuth(stored, '/api/auth/me');
        if (cancelled) return;
        if (!res.ok) {
          clearSession();
          setToken(null);
          setUser(null);
          return;
        }
        const u = await res.json();
        if (!cancelled) setUser(u);
      } catch {
        if (!cancelled) {
          clearSession();
          setToken(null);
          setUser(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return {
    user,
    token,
    isAuthenticated,
    isLoading,
    error,
    login,
    register,
    loginAsGuest,
    logout,
    clearError,
  };
}
