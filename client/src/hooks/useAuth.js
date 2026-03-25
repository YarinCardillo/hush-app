/**
 * BIP39 auth hook: challenge-response authentication, vault PIN management,
 * vault timeout, and scorched-earth logout.
 *
 * Auth flow:
 *   1. Derive keypair from mnemonic via bip39Identity.mnemonicToIdentityKey
 *   2. Request challenge nonce via api.requestChallenge
 *   3. Sign nonce via bip39Identity.signChallenge
 *   4. Submit signature via api.verifyChallenge → receive JWT
 *
 * Vault states:
 *   'none'     — no vault exists, show login/register UI
 *   'locked'   — vault exists but PIN not entered
 *   'unlocked' — private key in memory, JWT valid
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  mnemonicToIdentityKey,
  signChallenge,
} from '../lib/bip39Identity';
import {
  encryptVault,
  decryptVault,
  openVaultStore,
  saveEncryptedKey,
  loadEncryptedKey,
  deleteVaultDatabase,
  getVaultConfig,
  bytesToHex,
  hexToBytes as vaultHexToBytes,
  saveSaltToIDB,
  saveVaultMarkerToIDB,
  checkVaultExistsInIDB,
  loadVaultMarkerFromIDB,
} from '../lib/identityVault';
import {
  fetchWithAuth,
  uploadKeyPackagesAfterAuth,
  requestChallenge,
  verifyChallenge,
  registerWithPublicKey,
} from '../lib/api';

// ── Module-level constants ───────────────────────────────────────────────────

export const JWT_KEY = 'hush_jwt';

const DEVICE_ID_KEY = 'hush_device_id';
const VAULT_USER_KEY_PREFIX = 'hush_vault_user_';
const VAULT_SESSION_FLAG = 'hush_vault_session_alive';
const PIN_ATTEMPTS_KEY_PREFIX = 'hush_pin_attempts_';
const INACTIVITY_EVENTS = ['mousemove', 'keydown', 'touchstart', 'click'];

/** Progressive delay in ms by failure count threshold. */
const PIN_DELAY_TABLE = [
  { threshold: 9, delayMs: 60_000 },
  { threshold: 7, delayMs: 30_000 },
  { threshold: 5, delayMs: 5_000 },
  { threshold: 3, delayMs: 1_000 },
];

const MAX_PIN_FAILURES = 10;

// ── Module-level helpers ─────────────────────────────────────────────────────

/**
 * Returns or generates a stable per-device UUID stored in localStorage.
 * @returns {string}
 */
export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID?.() ?? `dev_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

/**
 * Clears the JWT from sessionStorage and the vault session flag.
 * Does NOT wipe vault IDB or localStorage — use performLogout for full wipe.
 */
export function clearSession() {
  sessionStorage.removeItem(JWT_KEY);
  sessionStorage.removeItem(VAULT_SESSION_FLAG);
}

/**
 * Encodes a Uint8Array to a base64 string.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function toBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Returns the delay in ms to impose before accepting the next PIN attempt,
 * based on the number of prior failures.
 * @param {number} failureCount
 * @returns {number} ms to wait (0 if under threshold)
 */
function pinDelayMs(failureCount) {
  for (const { threshold, delayMs } of PIN_DELAY_TABLE) {
    if (failureCount >= threshold) return delayMs;
  }
  return 0;
}

/**
 * Loads the PIN attempt record from localStorage for a user.
 * @param {string} userId
 * @returns {{ count: number, lastAttemptAt: string|null }}
 */
function loadPinAttempts(userId) {
  const raw = localStorage.getItem(`${PIN_ATTEMPTS_KEY_PREFIX}${userId}`);
  if (!raw) return { count: 0, lastAttemptAt: null };
  try {
    return JSON.parse(raw);
  } catch {
    return { count: 0, lastAttemptAt: null };
  }
}

/**
 * Persists the PIN attempt record to localStorage.
 * @param {string} userId
 * @param {{ count: number, lastAttemptAt: string }} record
 */
function savePinAttempts(userId, record) {
  localStorage.setItem(`${PIN_ATTEMPTS_KEY_PREFIX}${userId}`, JSON.stringify(record));
}

/**
 * Resets the PIN attempt counter for a user after successful unlock.
 * @param {string} userId
 */
function clearPinAttempts(userId) {
  localStorage.removeItem(`${PIN_ATTEMPTS_KEY_PREFIX}${userId}`);
}

// ── Main hook ────────────────────────────────────────────────────────────────

/**
 * BIP39 auth hook providing challenge-response login, vault PIN management,
 * vault timeout, and scorched-earth logout.
 *
 * @returns {{
 *   user: object|null,
 *   token: string|null,
 *   vaultState: 'none'|'locked'|'unlocked',
 *   isAuthenticated: boolean,
 *   loading: boolean,
 *   error: Error|null,
 *   performChallengeResponse: (privateKey: Uint8Array, publicKey: Uint8Array) => Promise<void>,
 *   performRegister: (username: string, displayName: string, mnemonic: string, inviteCode?: string) => Promise<void>,
 *   performRecovery: (mnemonic: string, revokeOtherDevices?: boolean) => Promise<void>,
 *   unlockVault: (pin: string) => Promise<void>,
 *   lockVault: () => void,
 *   setPIN: (pin: string) => Promise<void>,
 *   performLogout: () => Promise<void>,
 *   clearError: () => void,
 * }}
 */
export function useAuth() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [vaultState, setVaultState] = useState('none');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // In-memory identity key — never persisted to any storage as plaintext.
  const identityKeyRef = useRef(null);

  // Inactivity timer handle.
  const inactivityTimerRef = useRef(null);

  const isAuthenticated = Boolean(token && user);

  const clearError = useCallback(() => setError(null), []);

  // ── Inactivity timer ───────────────────────────────────────────────────────

  /**
   * Clears the running inactivity timer.
   */
  const clearInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current != null) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
  }, []);

  /**
   * Starts (or resets) the inactivity lock timer for a numeric timeout config.
   * @param {number} timeoutMinutes
   */
  const startInactivityTimer = useCallback((timeoutMinutes) => {
    clearInactivityTimer();
    inactivityTimerRef.current = setTimeout(() => {
      identityKeyRef.current = null;
      setVaultState('locked');
    }, timeoutMinutes * 60 * 1000);
  }, [clearInactivityTimer]);

  // ── Vault configuration helpers ────────────────────────────────────────────

  /**
   * Applies the vault timeout policy for the given user after unlock.
   * @param {string} userId
   */
  const applyVaultTimeout = useCallback((userId) => {
    const config = getVaultConfig(userId);
    const timeout = config?.timeout ?? 'browser_close';

    if (timeout === 'browser_close') {
      // Mark session alive in sessionStorage; on next page load without this
      // flag (browser closed), vault stays locked.
      sessionStorage.setItem(VAULT_SESSION_FLAG, '1');
      return;
    }

    if (timeout === 'refresh') {
      sessionStorage.setItem(VAULT_SESSION_FLAG, '1');
      return;
    }

    if (timeout === 'never') {
      return;
    }

    if (typeof timeout === 'number' && timeout > 0) {
      sessionStorage.setItem(VAULT_SESSION_FLAG, '1');
      startInactivityTimer(timeout);

      const resetTimer = () => startInactivityTimer(timeout);
      INACTIVITY_EVENTS.forEach(ev => window.addEventListener(ev, resetTimer, { passive: true }));

      // Cleanup when vault locks or component unmounts is handled by the
      // useEffect that subscribes to vaultState changes.
      return resetTimer;
    }
  }, [startInactivityTimer]);

  // ── Core auth completion ───────────────────────────────────────────────────

  /**
   * Shared post-auth finalisation: upload MLS KeyPackages, persist JWT, update state.
   * @param {{ token: string, user: object }} data
   */
  const finishAuth = useCallback(async (data) => {
    const { token: jwt, user: u } = data;
    if (!jwt || !u?.id) throw new Error('invalid auth response');

    const deviceId = getDeviceId();
    await uploadKeyPackagesAfterAuth(jwt, u.id, deviceId);

    sessionStorage.setItem(JWT_KEY, jwt);
    setToken(jwt);
    setUser(u);
    return { token: jwt, user: u };
  }, []);

  // ── Challenge-response login ───────────────────────────────────────────────

  /**
   * Performs the full BIP39 challenge-response authentication flow.
   * Encodes the public key as base64, requests a nonce, signs it, submits.
   *
   * @param {Uint8Array} privateKey - 32-byte Ed25519 seed.
   * @param {Uint8Array} publicKey - 32-byte Ed25519 public key.
   */
  const performChallengeResponse = useCallback(async (privateKey, publicKey) => {
    const deviceId = getDeviceId();
    const publicKeyBase64 = toBase64(publicKey);

    const { nonce } = await requestChallenge(publicKeyBase64);

    const nonceBytes = hexToBytes(nonce);
    const signature = await signChallenge(nonceBytes, privateKey);
    const signatureBase64 = toBase64(signature);

    const data = await verifyChallenge(publicKeyBase64, nonce, signatureBase64, deviceId);

    // Keep private key in memory for vault lock/unlock, not in any storage.
    identityKeyRef.current = { privateKey, publicKey };

    const { user: u } = await finishAuth(data);

    // Mark vault key presence using public key hex (no secret material).
    localStorage.setItem(`${VAULT_USER_KEY_PREFIX}${u.id}`, bytesToHex(publicKey));
    setVaultState('unlocked');
    applyVaultTimeout(u.id);
    return { user: u };
  }, [finishAuth, applyVaultTimeout]);

  // ── Register ───────────────────────────────────────────────────────────────

  /**
   * Registers a new account from a BIP39 mnemonic, then authenticates.
   * PIN setup is deferred to first vault lock (user decision).
   *
   * @param {string} username
   * @param {string} displayName
   * @param {string} mnemonic - 12-word BIP39 mnemonic.
   * @param {string} [inviteCode] - Optional invite code.
   */
  const performRegister = useCallback(async (username, displayName, mnemonic, inviteCode) => {
    setLoading(true);
    setError(null);
    try {
      const { privateKey, publicKey } = await mnemonicToIdentityKey(mnemonic);
      const deviceId = getDeviceId();
      const publicKeyBase64 = toBase64(publicKey);

      const data = await registerWithPublicKey(
        username,
        displayName,
        publicKeyBase64,
        deviceId,
        inviteCode,
      );

      identityKeyRef.current = { privateKey, publicKey };

      const { user: u } = await finishAuth(data);

      localStorage.setItem(`${VAULT_USER_KEY_PREFIX}${u.id}`, bytesToHex(publicKey));
      setVaultState('unlocked');
      applyVaultTimeout(u.id);
      return { user: u };
    } catch (err) {
      setError(err);
      clearSession();
      setToken(null);
      setUser(null);
      setVaultState('none');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [finishAuth, applyVaultTimeout]);

  // ── Recovery ───────────────────────────────────────────────────────────────

  /**
   * Recovers account access from a mnemonic by performing challenge-response.
   * Optionally revokes all other registered device keys.
   *
   * @param {string} mnemonic - 12-word BIP39 mnemonic.
   * @param {boolean} [revokeOtherDevices=false]
   */
  const performRecovery = useCallback(async (mnemonic, revokeOtherDevices = false) => {
    setLoading(true);
    setError(null);
    try {
      const { privateKey, publicKey } = await mnemonicToIdentityKey(mnemonic);

      const authResult = await performChallengeResponse(privateKey, publicKey);

      if (revokeOtherDevices) {
        const jwt = sessionStorage.getItem(JWT_KEY);
        const deviceId = getDeviceId();
        const { listDeviceKeys, revokeDeviceKey } = await import('../lib/api');
        const devices = await listDeviceKeys(jwt);
        await Promise.allSettled(
          devices
            .filter(d => d.deviceId !== deviceId)
            .map(d => revokeDeviceKey(jwt, d.deviceId)),
        );
      }
      return authResult;
    } catch (err) {
      setError(err);
      clearSession();
      setToken(null);
      setUser(null);
      setVaultState('none');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [performChallengeResponse]);

  // ── Vault PIN management ───────────────────────────────────────────────────

  /**
   * Attempts to unlock the vault with a PIN.
   * Applies progressive delays on failure and wipes vault after MAX_PIN_FAILURES.
   *
   * @param {string} pin
   */
  const unlockVault = useCallback(async (pin) => {
    const userId = user?.id ?? localStorage.getItem(`${VAULT_USER_KEY_PREFIX}_last_user`);
    if (!userId) throw new Error('no active vault user');

    const attempts = loadPinAttempts(userId);
    const delay = pinDelayMs(attempts.count);
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    try {
      const db = await openVaultStore(userId);
      const blob = await loadEncryptedKey(db);

      if (!blob) {
        db.close();
        throw new Error('vault is empty');
      }

      const privateKey = await decryptVault(blob, pin);

      // Derive public key from stored hex marker. If localStorage was evicted
      // (iOS non-Safari), fall back to IDB backup.
      let storedHex = localStorage.getItem(`${VAULT_USER_KEY_PREFIX}${userId}`);
      if (!storedHex) {
        const idbMarker = await loadVaultMarkerFromIDB(db);
        if (typeof idbMarker === 'string' && idbMarker) {
          storedHex = idbMarker;
          localStorage.setItem(`${VAULT_USER_KEY_PREFIX}${userId}`, storedHex);
        }
      }
      db.close();

      const publicKey = storedHex ? hexToBytes(storedHex) : null;

      identityKeyRef.current = { privateKey, publicKey };
      clearPinAttempts(userId);

      // If no JWT (tab was closed, sessionStorage wiped), re-authenticate
      // with challenge-response to get a fresh session.
      const existingJwt = sessionStorage.getItem(JWT_KEY);
      if (!existingJwt && publicKey && privateKey) {
        const authResult = await performChallengeResponse(privateKey, publicKey);
        // performChallengeResponse sets token, user, vaultState='unlocked', applyVaultTimeout.
        return authResult;
      }

      setVaultState('unlocked');
      applyVaultTimeout(userId);
    } catch (err) {
      const newCount = attempts.count + 1;
      savePinAttempts(userId, { count: newCount, lastAttemptAt: new Date().toISOString() });

      if (newCount >= MAX_PIN_FAILURES) {
        await deleteVaultDatabase(userId);
        clearSession();
        localStorage.removeItem(`${VAULT_USER_KEY_PREFIX}${userId}`);
        localStorage.removeItem(`${PIN_ATTEMPTS_KEY_PREFIX}${userId}`);
        setToken(null);
        setUser(null);
        setVaultState('none');
        identityKeyRef.current = null;

        const wipeError = new Error('vault wiped after too many failed PIN attempts');
        wipeError.code = 'VAULT_WIPED';
        throw wipeError;
      }

      const wrongPinError = new Error(
        `incorrect PIN (${MAX_PIN_FAILURES - newCount} attempts remaining)`,
      );
      wrongPinError.code = 'WRONG_PIN';
      throw wrongPinError;
    }
  }, [user, applyVaultTimeout]);

  /**
   * Locks the vault by clearing the in-memory private key.
   * Does NOT delete vault IDB data — use performLogout for full wipe.
   */
  const lockVault = useCallback(() => {
    identityKeyRef.current = null;
    clearInactivityTimer();
    setVaultState('locked');
  }, [clearInactivityTimer]);

  /**
   * Encrypts the current in-memory private key with a PIN and saves it to vault IDB.
   * Call this from settings UI when the user first sets or changes their PIN.
   *
   * @param {string} pin
   */
  const setPIN = useCallback(async (pin) => {
    if (!identityKeyRef.current?.privateKey) {
      throw new Error('no identity key in memory — must be unlocked first');
    }
    if (!user?.id) throw new Error('no authenticated user');

    const blob = await encryptVault(identityKeyRef.current.privateKey, pin);
    const db = await openVaultStore(user.id);
    await saveEncryptedKey(db, blob);

    // Back up PBKDF2 salt and vault marker to IDB so they survive
    // localStorage eviction on iOS non-Safari browsers.
    const saltHex = localStorage.getItem('hush_vault_salt');
    if (saltHex) {
      await saveSaltToIDB(db, vaultHexToBytes(saltHex));
    }
    const pubKeyHex = localStorage.getItem(`${VAULT_USER_KEY_PREFIX}${user.id}`);
    if (pubKeyHex) {
      await saveVaultMarkerToIDB(db, pubKeyHex);
    }

    db.close();
  }, [user]);

  // ── Scorched-earth logout ──────────────────────────────────────────────────

  /**
   * Performs a full scorched-earth logout per IDEN-08:
   *   1. POST /api/auth/logout (best-effort)
   *   2. BroadcastChannel message to other tabs
   *   3. Delete all hush IDB databases
   *   4. Clear localStorage and sessionStorage
   *   5. Unregister all service workers
   *   6. Clear Cache API
   *   7. Reset all in-memory state
   */
  const performLogout = useCallback(async () => {
    setLoading(true);

    const jwt = sessionStorage.getItem(JWT_KEY);
    const userId = user?.id;

    // 1. Best-effort server logout.
    if (jwt) {
      try {
        await fetchWithAuth(jwt, '/api/auth/logout', { method: 'POST' });
      } catch {
        // Ignore — local wipe proceeds regardless.
      }
    }

    // 2. Notify other tabs.
    try {
      const bc = new BroadcastChannel('hush_auth');
      bc.postMessage({ type: 'hush_logout' });
      bc.close();
    } catch {
      // BroadcastChannel may not be available in all environments.
    }

    // 3. Delete all hush IDB databases.
    const deviceId = getDeviceId();
    const deleteTargets = [];

    if (userId) {
      deleteTargets.push(
        deleteVaultDatabase(userId).catch(() => undefined),
        new Promise(resolve => {
          const req = indexedDB.deleteDatabase(`hush-mls-${userId}-${deviceId}`);
          req.onsuccess = req.onerror = req.onblocked = () => resolve();
        }),
      );
    }

    await Promise.allSettled(deleteTargets);

    // 4. Clear web storage.
    localStorage.clear();
    sessionStorage.clear();

    // 5. Unregister service workers.
    if ('serviceWorker' in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.allSettled(registrations.map(r => r.unregister()));
      } catch {
        // Ignore.
      }
    }

    // 6. Clear Cache API.
    if ('caches' in window) {
      try {
        const cacheNames = await caches.keys();
        await Promise.allSettled(cacheNames.map(name => caches.delete(name)));
      } catch {
        // Ignore.
      }
    }

    // 7. Reset in-memory state.
    identityKeyRef.current = null;
    clearInactivityTimer();
    setToken(null);
    setUser(null);
    setVaultState('none');
    setError(null);
    setLoading(false);
  }, [user, clearInactivityTimer]);

  // ── Startup: session rehydration ──────────────────────────────────────────

  useEffect(() => {
    const stored = sessionStorage.getItem(JWT_KEY);
    const sessionAlive = sessionStorage.getItem(VAULT_SESSION_FLAG) === '1';

    if (!stored) {
      // No JWT — but vault may still exist (tab closed, sessionStorage wiped).
      // Check localStorage for vault marker. If found, show PIN unlock;
      // after unlock, challenge-response auth gets a fresh JWT.
      const vaultUserId = Object.keys(localStorage)
        .find(k => k.startsWith(VAULT_USER_KEY_PREFIX) && !k.endsWith('_last_user') && localStorage.getItem(k));
      if (vaultUserId) {
        const userId = vaultUserId.slice(VAULT_USER_KEY_PREFIX.length);
        localStorage.setItem(`${VAULT_USER_KEY_PREFIX}_last_user`, userId);
        setVaultState('locked');
        setLoading(false);
        return;
      }

      // localStorage marker missing — iOS non-Safari browsers may have evicted
      // localStorage while IndexedDB survives. Check IDB for vault existence.
      // Also try to find userId from the last_user hint in localStorage.
      const lastUser = localStorage.getItem(`${VAULT_USER_KEY_PREFIX}_last_user`);
      let idbCancelled = false;
      (async () => {
        try {
          // Try known userId first, then scan IDB databases for vault pattern.
          const candidates = lastUser ? [lastUser] : [];

          // indexedDB.databases() returns all IDB databases — scan for vault DBs.
          if (!candidates.length && typeof indexedDB.databases === 'function') {
            const dbs = await indexedDB.databases();
            for (const db of dbs) {
              const match = db.name?.match(/^hush-vault-(.+)$/);
              if (match) candidates.push(match[1]);
            }
          }

          if (idbCancelled) return;

          for (const userId of candidates) {
            const result = await checkVaultExistsInIDB(userId);
            if (idbCancelled) return;
            if (result.exists) {
              // Vault found in IDB — restore localStorage markers from IDB backup.
              if (result.publicKeyHex) {
                localStorage.setItem(`${VAULT_USER_KEY_PREFIX}${userId}`, result.publicKeyHex);
              }
              localStorage.setItem(`${VAULT_USER_KEY_PREFIX}_last_user`, userId);
              setVaultState('locked');
              setLoading(false);
              return;
            }
          }
        } catch {
          // IDB check failed — fall through to no-vault state.
        }

        if (!idbCancelled) {
          // No vault at all — show login/register.
          setLoading(false);
          setVaultState('none');
        }
      })();
      // eslint-disable-next-line no-return-assign
      return () => { idbCancelled = true; };
    }

    let cancelled = false;

    (async () => {
      try {
        const res = await fetchWithAuth(stored, '/api/auth/me');
        if (cancelled) return;

        if (res.status === 401) {
          clearSession();
          setToken(null);
          setUser(null);
          setVaultState('none');
          return;
        }

        if (!res.ok) {
          // Transient error — keep session alive, fall through to state check.
          setToken(stored);
          // State determined below.
        } else {
          const u = await res.json();
          if (cancelled) return;
          setToken(stored);
          setUser(u);

          const vaultPublicKeyHex = localStorage.getItem(`${VAULT_USER_KEY_PREFIX}${u.id}`);

          if (vaultPublicKeyHex && sessionAlive) {
            // Vault unlocked before the current session; treat as unlocked
            // since the session flag persisted (tab reload, not browser close).
            setVaultState('unlocked');
            applyVaultTimeout(u.id);
          } else if (vaultPublicKeyHex) {
            // Vault exists but session flag absent (browser restarted or
            // refresh policy) — require PIN re-entry.
            setVaultState('locked');
          } else {
            // Authenticated via JWT but no vault set up yet.
            setVaultState('unlocked');
          }
        }
      } catch {
        // Network error — keep token, keep as locked if vault exists.
        setToken(stored);
        setVaultState('locked');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Request persistent storage ───────────────────────────────────────────
  // Opt out of best-effort eviction on iOS. Without this, non-Safari browsers
  // (Chrome iOS, Google in-app) may lose localStorage and IDB under memory
  // pressure because WKWebView apps get lower storage quotas.

  useEffect(() => {
    if (navigator.storage?.persist) {
      navigator.storage.persist().catch(() => { /* best-effort */ });
    }
  }, []);

  // ── Visibility change re-verification ─────────────────────────────────────

  useEffect(() => {
    const onVisible = async () => {
      if (document.visibilityState !== 'visible') return;
      const stored = sessionStorage.getItem(JWT_KEY);
      if (!stored) return;

      try {
        const res = await fetchWithAuth(stored, '/api/auth/me');
        if (res.status === 401) {
          clearSession();
          window.location.href = '/';
        }
      } catch {
        // Network error — don't log out, user may be offline.
      }
    };

    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // ── Inactivity cleanup on vault lock ──────────────────────────────────────

  useEffect(() => {
    if (vaultState !== 'unlocked') {
      clearInactivityTimer();
    }
  }, [vaultState, clearInactivityTimer]);

  // ── BroadcastChannel logout listener ─────────────────────────────────────

  useEffect(() => {
    let bc;
    try {
      bc = new BroadcastChannel('hush_auth');
      bc.onmessage = (event) => {
        if (event.data?.type === 'hush_logout') {
          identityKeyRef.current = null;
          clearInactivityTimer();
          setToken(null);
          setUser(null);
          setVaultState('none');
        }
      };
    } catch {
      // BroadcastChannel unavailable.
    }
    return () => { try { bc?.close(); } catch { /* noop */ } };
  }, [clearInactivityTimer]);

  return {
    user,
    token,
    vaultState,
    isAuthenticated,
    loading,
    error,
    performChallengeResponse,
    performRegister,
    performRecovery,
    unlockVault,
    lockVault,
    setPIN,
    performLogout,
    clearError,
    // Ref to the in-memory identity keypair. Used by useInstances for
    // challenge-response auth on remote instances. Never serialized.
    identityKeyRef,
    // Legacy aliases preserved for compatibility with existing consumers.
    isLoading: loading,
  };
}

// ── Local hex helpers (mirrors identityVault.hexToBytes without import cycle) ─

/**
 * Converts a hex string to a Uint8Array.
 * @param {string} hex
 * @returns {Uint8Array}
 */
function hexToBytes(hex) {
  const result = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    result[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return result;
}
