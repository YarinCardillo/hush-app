/**
 * Auth hook for Go backend: login, register, guest, session rehydration.
 * JWT in sessionStorage (hush_jwt); deviceId in localStorage (hush_device_id).
 */

import { useState, useCallback, useEffect } from 'react';
import { fetchWithAuth, uploadKeysAfterAuth } from '../lib/api';

const JWT_KEY = 'hush_jwt';
const DEVICE_ID_KEY = 'hush_device_id';
const defaultBase = '';

function getDeviceId() {
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

function setSession(token, user) {
  if (token) sessionStorage.setItem(JWT_KEY, token);
  return { token: token || null, user: user || null };
}

function clearSession() {
  sessionStorage.removeItem(JWT_KEY);
  return { token: null, user: null };
}

/**
 * After successful auth response: store token, upload Signal keys, return user.
 * @param {{ token: string, user: { id: string } }} data - Auth response
 * @returns {Promise<{ user: object }>}
 */
async function finishAuth(data) {
  const { token, user } = data;
  if (!token || !user?.id) throw new Error('invalid auth response');
  sessionStorage.setItem(JWT_KEY, token);
  const deviceId = getDeviceId();
  await uploadKeysAfterAuth(token, user.id, deviceId);
  return { user };
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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const isAuthenticated = Boolean(token && user);

  const clearError = useCallback(() => setError(null), []);

  const login = useCallback(async (username, password) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await postAuth('/api/auth/login', { username, password });
      const { user: u } = await finishAuth(data);
      setToken(data.token);
      setUser(u);
    } catch (err) {
      setError(err);
      setToken(null);
      setUser(null);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const register = useCallback(async (username, password, displayName) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await postAuth('/api/auth/register', {
        username,
        password,
        displayName: displayName || username,
      });
      const { user: u } = await finishAuth(data);
      setToken(data.token);
      setUser(u);
    } catch (err) {
      setError(err);
      setToken(null);
      setUser(null);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loginAsGuest = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await postAuth('/api/auth/guest');
      const { user: u } = await finishAuth(data);
      setToken(data.token);
      setUser(u);
    } catch (err) {
      setError(err);
      setToken(null);
      setUser(null);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const t = sessionStorage.getItem(JWT_KEY);
      if (t) {
        try {
          await fetchWithAuth(t, '/api/auth/logout', { method: 'POST' });
        } catch {
          // Ignore logout API failure
        }
      }
      const cleared = clearSession();
      setToken(cleared.token);
      setUser(cleared.user);
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
      setUser(null);
      return;
    }

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
      } catch (err) {
        if (!cancelled) {
          clearSession();
          setToken(null);
          setUser(null);
        }
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
