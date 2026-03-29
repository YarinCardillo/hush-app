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
  signTransparencyEntry,
} from '../lib/bip39Identity';
import {
  encryptVault,
  decryptVaultAndExportKey,
  decryptVaultWithRawKey,
  openVaultStore,
  saveEncryptedKey,
  loadEncryptedKey,
  deleteVaultDatabase,
  getVaultConfig,
  setVaultConfig,
  bytesToHex,
  hexToBytes as vaultHexToBytes,
  saveSaltToIDB,
  saveVaultMarkerToIDB,
  checkVaultExistsInIDB,
  loadVaultMarkerFromIDB,
} from '../lib/identityVault';
import {
  openHistoryStore,
  importHistorySnapshot,
} from '../lib/mlsStore';
import {
  fetchWithAuth,
  uploadKeyPackagesAfterAuth,
  requestChallenge,
  verifyChallenge,
  registerWithPublicKey,
  requestGuestSession,
} from '../lib/api';

// ── JWT utilities ─────────────────────────────────────────────────────────────

/**
 * Decodes a JWT payload without verifying the signature.
 * Used client-side only to read claims (expiry, is_guest) that were already
 * signed by the trusted server — signature verification is the server's job.
 *
 * @param {string} token - JWT string
 * @returns {object | null} Parsed payload claims, or null on error
 */
function parseJwtClaims(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // Base64url → base64 → JSON
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Guest session warning shown 5 minutes before expiry. */
const GUEST_EXPIRY_WARNING_MS = 5 * 60 * 1000;

// ── Module-level constants ───────────────────────────────────────────────────

export const JWT_KEY = 'hush_jwt';

const DEVICE_ID_KEY = 'hush_device_id';
const VAULT_USER_KEY_PREFIX = 'hush_vault_user_';
const VAULT_SESSION_FLAG = 'hush_vault_session_alive';
const VAULT_DERIVED_KEY = 'hush_vault_derived_key';
const VAULT_IDLE_DEADLINE_KEY = 'hush_vault_idle_deadline';
const LEGACY_VAULT_TIMEOUT_KEY = 'hush_vault_timeout';
const PIN_SETUP_PENDING_KEY = 'hush_pin_setup_pending';
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
  sessionStorage.removeItem(VAULT_DERIVED_KEY);
  sessionStorage.removeItem(PIN_SETUP_PENDING_KEY);
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
 * Parses the legacy global vault-timeout selector value into the normalized
 * timeout shape used by identityVault config.
 *
 * @param {string|null} raw
 * @returns {'browser_close'|'refresh'|'never'|number|null}
 */
function parseLegacyVaultTimeout(raw) {
  switch (raw) {
    case 'browser_close':
    case 'refresh':
    case 'never':
      return raw;
    case '1m':
      return 1;
    case '15m':
      return 15;
    case '30m':
      return 30;
    case '1h':
      return 60;
    case '4h':
      return 240;
    default:
      return null;
  }
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
 *   needsPinSetup: boolean,
 *   isGuest: boolean,
 *   guestExpiresAt: string|null,
 *   voiceDisconnectRef: React.MutableRefObject<(() => void)|null>,
 *   performChallengeResponse: (privateKey: Uint8Array, publicKey: Uint8Array, baseUrl?: string) => Promise<void>,
 *   performRegister: (username: string, displayName: string, mnemonic: string, inviteCode?: string, baseUrl?: string) => Promise<void>,
 *   performRecovery: (mnemonic: string, revokeOtherDevices?: boolean, baseUrl?: string) => Promise<void>,
 *   completeDeviceLink: (bundle: { rootPrivateKey: Uint8Array, rootPublicKey: Uint8Array, historySnapshot?: object|null }, baseUrl?: string) => Promise<void>,
 *   performGuestAuth: () => Promise<{ user: object }>,
 *   unlockVault: (pin: string) => Promise<void>,
 *   lockVault: () => void,
 *   setPIN: (pin: string) => Promise<void>,
 *   skipPinSetup: () => void,
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
  const [needsPinSetup, setNeedsPinSetupState] = useState(
    () => sessionStorage.getItem(PIN_SETUP_PENDING_KEY) === '1',
  );

  /**
   * Set when transparency log verification detects a key mismatch.
   * Non-null value blocks the app UI — see transparencyError in the return value.
   *
   * Owned here so any component in the tree can read the error via useAuth().
   * Set externally by ServerLayout after fetching handshakeData and running
   * TransparencyVerifier.verifyOwnKey().
   */
  const [transparencyError, setTransparencyError] = useState(null);

  /** True when the current session is a guest (short-lived, no BIP39 identity). */
  const [isGuest, setIsGuest] = useState(false);
  /**
   * ISO timestamp of guest session expiry. Non-null only when isGuest === true.
   * Used by the UI to display the expiry countdown.
   */
  const [guestExpiresAt, setGuestExpiresAt] = useState(null);

  // In-memory identity key — never persisted to any storage as plaintext.
  const identityKeyRef = useRef(null);

  // Inactivity timer handle.
  const inactivityTimerRef = useRef(null);

  // Guest session expiry timers.
  const guestWarningTimerRef = useRef(null);
  const guestExpiryTimerRef = useRef(null);

  /**
   * Optional voice-disconnect callback. Set by the voice layer so that guest
   * expiry can cleanly disconnect an active call before redirecting.
   *
   * Pattern: voiceDisconnectRef.current = () => room.disconnect()
   * Clear on voice component unmount: voiceDisconnectRef.current = null
   */
  const voiceDisconnectRef = useRef(null);

  const isAuthenticated = Boolean(token && user);

  const clearError = useCallback(() => setError(null), []);
  const setPinSetupPendingState = useCallback((pending) => {
    setNeedsPinSetupState(pending);
    if (pending) {
      sessionStorage.setItem(PIN_SETUP_PENDING_KEY, '1');
      return;
    }
    sessionStorage.removeItem(PIN_SETUP_PENDING_KEY);
  }, []);
  const requirePinSetup = useCallback(() => setPinSetupPendingState(true), [setPinSetupPendingState]);
  const clearPinSetup = useCallback(() => setPinSetupPendingState(false), [setPinSetupPendingState]);

  // ── Guest session timers ───────────────────────────────────────────────────

  /**
   * Cancels any running guest warning/expiry timers. Safe to call multiple times.
   */
  const clearGuestTimers = useCallback(() => {
    if (guestWarningTimerRef.current != null) {
      clearTimeout(guestWarningTimerRef.current);
      guestWarningTimerRef.current = null;
    }
    if (guestExpiryTimerRef.current != null) {
      clearTimeout(guestExpiryTimerRef.current);
      guestExpiryTimerRef.current = null;
    }
  }, []);

  /**
   * Schedules a 5-minute warning and expiry action for a guest session.
   *
   * At T-5 minutes: emits a 'guest_expiry_warning' CustomEvent on window so
   *   any component can show a persistent toast.
   * At T-0: disconnects voice (if registered), clears local auth state,
   *   and redirects to /register (BIP39 onboarding).
   *
   * @param {number} expiresAtMs - Unix timestamp in milliseconds
   */
  const startGuestExpiryTimers = useCallback((expiresAtMs) => {
    clearGuestTimers();

    const now = Date.now();
    const totalMs = expiresAtMs - now;
    if (totalMs <= 0) return; // Already expired.

    const warningMs = totalMs - GUEST_EXPIRY_WARNING_MS;

    if (warningMs > 0) {
      guestWarningTimerRef.current = setTimeout(() => {
        window.dispatchEvent(new CustomEvent('hush_guest_expiry_warning', {
          detail: { expiresAt: new Date(expiresAtMs).toISOString() },
        }));
      }, warningMs);
    } else {
      // Less than 5 minutes remaining — show warning immediately.
      window.dispatchEvent(new CustomEvent('hush_guest_expiry_warning', {
        detail: { expiresAt: new Date(expiresAtMs).toISOString() },
      }));
    }

    guestExpiryTimerRef.current = setTimeout(() => {
      // 1. Disconnect voice if active.
      if (voiceDisconnectRef.current) {
        try { voiceDisconnectRef.current(); } catch { /* ignore */ }
      }

      // 2. Show expiry toast (via CustomEvent — decoupled from any toast lib).
      window.dispatchEvent(new CustomEvent('hush_guest_session_expired'));

      // 3. Clear auth state (silent — no BroadcastChannel; guest has no other tabs).
      sessionStorage.removeItem(JWT_KEY);
      sessionStorage.removeItem(VAULT_SESSION_FLAG);
      setToken(null);
      setUser(null);
      setVaultState('none');
      setIsGuest(false);
      setGuestExpiresAt(null);
      clearGuestTimers();

      // 4. Redirect to BIP39 registration (not login — guests have no account).
      if (typeof window !== 'undefined') {
        window.location.href = '/register';
      }
    }, totalMs);
  }, [clearGuestTimers]);

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
   * Clears the persisted inactivity deadline used to enforce numeric vault
   * timeouts across background/foreground transitions.
   */
  const clearInactivityDeadline = useCallback(() => {
    inactivityDeadlineRef.current = null;
    sessionStorage.removeItem(VAULT_IDLE_DEADLINE_KEY);
  }, []);

  /**
   * Persists the absolute deadline for the active numeric vault timeout.
   *
   * @param {number} deadlineMs
   */
  const setInactivityDeadline = useCallback((deadlineMs) => {
    inactivityDeadlineRef.current = deadlineMs;
    sessionStorage.setItem(VAULT_IDLE_DEADLINE_KEY, String(deadlineMs));
  }, []);

  /**
   * Reads the current inactivity deadline from memory or sessionStorage.
   *
   * @returns {number|null}
   */
  const getInactivityDeadline = useCallback(() => {
    if (typeof inactivityDeadlineRef.current === 'number') {
      return inactivityDeadlineRef.current;
    }

    const raw = sessionStorage.getItem(VAULT_IDLE_DEADLINE_KEY);
    if (!raw) return null;

    const deadlineMs = Number(raw);
    if (!Number.isFinite(deadlineMs)) {
      sessionStorage.removeItem(VAULT_IDLE_DEADLINE_KEY);
      return null;
    }

    inactivityDeadlineRef.current = deadlineMs;
    return deadlineMs;
  }, []);

  /**
   * Applies a hard vault lock caused by inactivity expiry.
   *
   * Clears the derived AES key so a reload cannot auto-unlock after the vault
   * has timed out.
   */
  const lockVaultForTimeout = useCallback(() => {
    identityKeyRef.current = null;
    sessionStorage.removeItem(VAULT_DERIVED_KEY);
    clearInactivityDeadline();
    setVaultState('locked');
  }, [clearInactivityDeadline]);

  /**
   * Arms the inactivity timer to fire at the given absolute deadline.
   *
   * @param {number} deadlineMs
   */
  const startInactivityTimer = useCallback((deadlineMs) => {
    clearInactivityTimer();

    const remainingMs = Math.max(deadlineMs - Date.now(), 0);
    if (remainingMs === 0) {
      lockVaultForTimeout();
      return;
    }

    inactivityTimerRef.current = setTimeout(() => {
      lockVaultForTimeout();
    }, remainingMs);
  }, [clearInactivityTimer, lockVaultForTimeout]);

  // ── Vault configuration helpers ────────────────────────────────────────────

  /**
   * Applies the vault timeout policy for the given user after unlock.
   * @param {string} userId
   */
  /**
   * Ref for the beforeunload handler used by the 'refresh' vault timeout
   * policy. Stored in a ref so it can be removed on vault lock or unmount.
   */
  const beforeUnloadRef = useRef(null);
  const inactivityResetRef = useRef(null);
  const inactivityResumeRef = useRef(null);
  const inactivityDeadlineRef = useRef(null);

  /**
   * Clears all window-level side effects associated with the active vault
   * timeout policy so a new policy can be applied cleanly.
   */
  const clearVaultTimeoutEffects = useCallback(() => {
    clearInactivityTimer();
    clearInactivityDeadline();
    if (beforeUnloadRef.current) {
      window.removeEventListener('beforeunload', beforeUnloadRef.current);
      beforeUnloadRef.current = null;
    }
    if (inactivityResetRef.current) {
      INACTIVITY_EVENTS.forEach((ev) => {
        window.removeEventListener(ev, inactivityResetRef.current);
      });
      inactivityResetRef.current = null;
    }
    if (inactivityResumeRef.current) {
      document.removeEventListener('visibilitychange', inactivityResumeRef.current);
      window.removeEventListener('focus', inactivityResumeRef.current);
      window.removeEventListener('pageshow', inactivityResumeRef.current);
      inactivityResumeRef.current = null;
    }
  }, [clearInactivityDeadline, clearInactivityTimer]);

  /**
   * Returns the effective per-user vault config. If the old global timeout key
   * is still present, migrate it into the per-user config on first read.
   *
   * @param {string} userId
   * @returns {{ timeout: string|number, pinType: string }|null}
   */
  const getEffectiveVaultConfig = useCallback((userId) => {
    const existing = getVaultConfig(userId);
    if (existing?.timeout !== undefined) {
      return existing;
    }

    const legacyTimeout = parseLegacyVaultTimeout(localStorage.getItem(LEGACY_VAULT_TIMEOUT_KEY));
    if (legacyTimeout == null) {
      return existing;
    }

    const migrated = {
      timeout: legacyTimeout,
      pinType: existing?.pinType ?? 'pin',
    };
    setVaultConfig(userId, migrated);
    localStorage.removeItem(LEGACY_VAULT_TIMEOUT_KEY);
    return migrated;
  }, []);

  const applyVaultTimeout = useCallback((userId) => {
    clearVaultTimeoutEffects();
    const config = getEffectiveVaultConfig(userId);
    const timeout = config?.timeout ?? 'browser_close';

    if (timeout === 'browser_close') {
      // Mark session alive in sessionStorage; on next page load without this
      // flag (browser closed), vault stays locked. The derived key persists
      // in sessionStorage so auto-unlock works on refresh.
      sessionStorage.setItem(VAULT_SESSION_FLAG, '1');
      return;
    }

    if (timeout === 'refresh') {
      // Session flag is set so we can detect browser-close vs refresh, but
      // the derived key is cleared on beforeunload so the vault re-locks on
      // every page refresh. This is the "lock on refresh" UX.
      sessionStorage.setItem(VAULT_SESSION_FLAG, '1');
      const handler = () => {
        sessionStorage.removeItem(VAULT_DERIVED_KEY);
      };
      window.addEventListener('beforeunload', handler);
      beforeUnloadRef.current = handler;
      return;
    }

    if (timeout === 'never') {
      // Derived key stays in sessionStorage indefinitely (until tab closes
      // or explicit logout). No session flag needed — auto-unlock always.
      sessionStorage.setItem(VAULT_SESSION_FLAG, '1');
      return;
    }

    if (typeof timeout === 'number' && timeout > 0) {
      sessionStorage.setItem(VAULT_SESSION_FLAG, '1');
      const timeoutMs = timeout * 60 * 1000;
      const resetTimer = () => {
        if (document.visibilityState === 'hidden') return;
        const deadlineMs = Date.now() + timeoutMs;
        setInactivityDeadline(deadlineMs);
        startInactivityTimer(deadlineMs);
      };
      const handleResume = () => {
        if (document.visibilityState === 'hidden') return;
        const deadlineMs = getInactivityDeadline();
        if (deadlineMs == null) {
          resetTimer();
          return;
        }
        if (Date.now() >= deadlineMs) {
          lockVaultForTimeout();
          return;
        }
        startInactivityTimer(deadlineMs);
      };

      resetTimer();
      INACTIVITY_EVENTS.forEach(ev => window.addEventListener(ev, resetTimer, { passive: true }));
      document.addEventListener('visibilitychange', handleResume);
      window.addEventListener('focus', handleResume);
      window.addEventListener('pageshow', handleResume);
      inactivityResetRef.current = resetTimer;
      inactivityResumeRef.current = handleResume;

      // Cleanup when vault locks or component unmounts is handled by the
      // useEffect that subscribes to vaultState changes.
      return resetTimer;
    }
  }, [
    clearVaultTimeoutEffects,
    getEffectiveVaultConfig,
    getInactivityDeadline,
    lockVaultForTimeout,
    setInactivityDeadline,
    startInactivityTimer,
  ]);

  // ── Core auth completion ───────────────────────────────────────────────────

  /**
   * Shared post-auth finalisation: upload MLS KeyPackages, persist JWT, update state.
   * For guest sessions (no user object): pass { token, guestId, expiresAt } and
   * set user to a synthetic guest object.
   *
   * @param {{ token: string, user?: object, guestId?: string, expiresAt?: string }} data
   * @param {string} [baseUrl]
   */
  const finishAuth = useCallback(async (data, baseUrl = '') => {
    const { token: jwt, user: u } = data;
    if (!jwt) throw new Error('invalid auth response');

    // Guest auth path: no persisted user, no KeyPackage upload.
    const claims = parseJwtClaims(jwt);
    if (claims?.is_guest) {
      sessionStorage.setItem(JWT_KEY, jwt);
      setToken(jwt);
      // Build a synthetic guest user object so isAuthenticated returns true.
      const guestUser = {
        id: claims.sub,
        username: claims.sub,
        displayName: 'Guest',
        role: 'guest',
      };
      setUser(guestUser);
      setIsGuest(true);
      clearPinSetup();
      const expiresAtIso = data.expiresAt ?? (claims.exp ? new Date(claims.exp * 1000).toISOString() : null);
      setGuestExpiresAt(expiresAtIso);
      if (expiresAtIso) {
        startGuestExpiryTimers(new Date(expiresAtIso).getTime());
      }
      return { token: jwt, user: guestUser };
    }

    if (!u?.id) throw new Error('invalid auth response');

    const deviceId = getDeviceId();
    await uploadKeyPackagesAfterAuth(jwt, u.id, deviceId, {}, baseUrl);

    sessionStorage.setItem(JWT_KEY, jwt);
    setToken(jwt);
    setUser(u);
    return { token: jwt, user: u };
  }, [startGuestExpiryTimers, clearPinSetup]);

  // ── Challenge-response login ───────────────────────────────────────────────

  /**
   * Performs the full BIP39 challenge-response authentication flow.
   * Encodes the public key as base64, requests a nonce, signs it, submits.
   *
   * @param {Uint8Array} privateKey - 32-byte Ed25519 seed.
   * @param {Uint8Array} publicKey - 32-byte Ed25519 public key.
   * @param {string} [baseUrl] - Optional auth instance base URL.
   */
  const performChallengeResponse = useCallback(async (privateKey, publicKey, baseUrl = '') => {
    const deviceId = getDeviceId();
    const publicKeyBase64 = toBase64(publicKey);

    const { nonce } = await requestChallenge(publicKeyBase64, baseUrl);

    const nonceBytes = hexToBytes(nonce);
    const signature = await signChallenge(nonceBytes, privateKey);
    const signatureBase64 = toBase64(signature);

    const data = await verifyChallenge(publicKeyBase64, nonce, signatureBase64, deviceId, baseUrl);

    // Keep private key in memory for vault lock/unlock, not in any storage.
    identityKeyRef.current = { privateKey, publicKey };

    const { user: u } = await finishAuth(data, baseUrl);

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
   * @param {string} [baseUrl] - Optional auth instance base URL.
   */
  const performRegister = useCallback(async (username, displayName, mnemonic, inviteCode, baseUrl = '') => {
    setLoading(true);
    setError(null);
    try {
      const { privateKey, publicKey } = await mnemonicToIdentityKey(mnemonic);
      const deviceId = getDeviceId();
      const publicKeyBase64 = toBase64(publicKey);

      // Sign a transparency entry so the server can append it to the log.
      // The server ignores transparency_sig if the instance has no log configured.
      const transparencyTs = Math.floor(Date.now() / 1000);
      let transparencySigBase64 = null;
      try {
        const { signature } = await signTransparencyEntry(
          privateKey,
          'register',
          publicKey,
          null,
          transparencyTs,
        );
        transparencySigBase64 = toBase64(signature);
      } catch (sigErr) {
        // Non-fatal: log warning and proceed without transparency sig.
        console.warn('[transparency] Failed to sign registration entry:', sigErr);
      }

      const data = await registerWithPublicKey(
        username,
        displayName,
        publicKeyBase64,
        deviceId,
        inviteCode,
        baseUrl,
        transparencySigBase64,
        transparencySigBase64 ? transparencyTs : null,
      );

      identityKeyRef.current = { privateKey, publicKey };

      const { user: u } = await finishAuth(data, baseUrl);

      localStorage.setItem(`${VAULT_USER_KEY_PREFIX}${u.id}`, bytesToHex(publicKey));
      requirePinSetup();
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
  }, [finishAuth, applyVaultTimeout, requirePinSetup]);

  // ── Recovery ───────────────────────────────────────────────────────────────

  /**
   * Recovers account access from a mnemonic by performing challenge-response.
   * Optionally revokes all other registered device keys.
   *
   * @param {string} mnemonic - 12-word BIP39 mnemonic.
   * @param {boolean} [revokeOtherDevices=false]
   * @param {string} [baseUrl] - Optional auth instance base URL.
   */
  const performRecovery = useCallback(async (mnemonic, revokeOtherDevices = false, baseUrl = '') => {
    setLoading(true);
    setError(null);
    try {
      const { privateKey, publicKey } = await mnemonicToIdentityKey(mnemonic);

      const authResult = await performChallengeResponse(privateKey, publicKey, baseUrl);

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
      requirePinSetup();
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
  }, [performChallengeResponse, requirePinSetup]);

  // ── Device linking ────────────────────────────────────────────────────────

  /**
   * Completes a device-link handoff using the transferred root key material.
   *
   * The new device authenticates with the transferred root key, uploads its own
   * MLS credential/key packages, imports the read-only history snapshot, and
   * then requires the user to set a fresh local PIN.
   *
   * @param {{ rootPrivateKey: Uint8Array, rootPublicKey: Uint8Array, historySnapshot?: object|null }} bundle
   * @param {string} [baseUrl] - Optional auth instance base URL.
   * @returns {Promise<{ user: object }>}
   */
  const completeDeviceLink = useCallback(async (bundle, baseUrl = '') => {
    setLoading(true);
    setError(null);

    let historyDb = null;
    try {
      if (!bundle?.rootPrivateKey || !bundle?.rootPublicKey) {
        throw new Error('invalid device link bundle');
      }

      const authResult = await performChallengeResponse(bundle.rootPrivateKey, bundle.rootPublicKey, baseUrl);

      if (bundle.historySnapshot && authResult?.user?.id) {
        historyDb = await openHistoryStore(authResult.user.id, getDeviceId());
        await importHistorySnapshot(historyDb, bundle.historySnapshot);
      }

      requirePinSetup();
      return authResult;
    } catch (err) {
      setError(err);
      clearSession();
      setToken(null);
      setUser(null);
      setVaultState('none');
      identityKeyRef.current = null;
      throw err;
    } finally {
      try {
        historyDb?.close();
      } catch {
        // Ignore close errors for best-effort cleanup.
      }
      setLoading(false);
    }
  }, [performChallengeResponse, requirePinSetup]);

  // ── Guest auth ─────────────────────────────────────────────────────────────

  /**
   * Starts an ephemeral guest session: calls POST /api/auth/guest and sets
   * in-memory auth state. No vault, no BIP39 identity — guests have a
   * short-lived JWT and are redirected to registration on expiry.
   *
   * @returns {Promise<{ user: object }>}
   */
  const performGuestAuth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await requestGuestSession();
      const result = await finishAuth(data);
      setVaultState('unlocked'); // Guests have no vault but are "unlocked" to use the app.
      return { user: result.user };
    } catch (err) {
      setError(err);
      setToken(null);
      setUser(null);
      setVaultState('none');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [finishAuth]);

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

      const { privateKey, rawKeyHex } = await decryptVaultAndExportKey(blob, pin);

      // Persist the derived AES key in sessionStorage so page refresh can
      // auto-unlock the vault without re-entering the PIN. The key is
      // cleared according to the vault timeout policy (see applyVaultTimeout).
      sessionStorage.setItem(VAULT_DERIVED_KEY, rawKeyHex);

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

      clearPinSetup();
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
  }, [user, applyVaultTimeout, clearPinSetup]);

  /**
   * Locks the vault by clearing the in-memory private key.
   * Does NOT delete vault IDB data — use performLogout for full wipe.
   */
  const lockVault = useCallback(() => {
    identityKeyRef.current = null;
    sessionStorage.removeItem(VAULT_DERIVED_KEY);
    clearVaultTimeoutEffects();
    setVaultState('locked');
  }, [clearVaultTimeoutEffects]);

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
    clearPinSetup();
  }, [user, clearPinSetup]);

  /**
   * Dismisses the post-auth PIN-setup prompt while keeping the current
   * authenticated session unlocked.
   */
  const skipPinSetup = useCallback(() => {
    clearPinSetup();
  }, [clearPinSetup]);

  /**
   * Updates the persisted vault timeout policy for the current user and
   * reapplies it immediately when the vault is already unlocked.
   *
   * @param {'browser_close'|'refresh'|'never'|number} timeout
   */
  const updateVaultTimeout = useCallback((timeout) => {
    if (!user?.id) return;

    const current = getEffectiveVaultConfig(user.id);
    setVaultConfig(user.id, {
      timeout,
      pinType: current?.pinType ?? 'pin',
    });
    localStorage.removeItem(LEGACY_VAULT_TIMEOUT_KEY);

    if (vaultState === 'unlocked') {
      applyVaultTimeout(user.id);
    }
  }, [applyVaultTimeout, getEffectiveVaultConfig, user?.id, vaultState]);

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
    clearVaultTimeoutEffects();
    clearGuestTimers();
    setToken(null);
    setUser(null);
    setVaultState('none');
    setNeedsPinSetupState(false);
    setIsGuest(false);
    setGuestExpiresAt(null);
    setError(null);
    setLoading(false);
  }, [user, clearGuestTimers, clearVaultTimeoutEffects]);

  // ── Startup: session rehydration ──────────────────────────────────────────

  useEffect(() => {
    const stored = sessionStorage.getItem(JWT_KEY);
    const sessionAlive = sessionStorage.getItem(VAULT_SESSION_FLAG) === '1';

    if (!stored) {
      clearPinSetup();

      // No JWT — but vault may still exist (tab closed, sessionStorage wiped).
      // Check localStorage for vault marker. If found, show PIN unlock;
      // after unlock, challenge-response auth gets a fresh JWT.
      const vaultUserId = Object.keys(localStorage)
        .find(k => k.startsWith(VAULT_USER_KEY_PREFIX) && !k.endsWith('_last_user') && localStorage.getItem(k));
      if (vaultUserId) {
        const userId = vaultUserId.slice(VAULT_USER_KEY_PREFIX.length);
        localStorage.setItem(`${VAULT_USER_KEY_PREFIX}_last_user`, userId);

        // Verify the vault actually has an encrypted key (PIN was set).
        // If registration completed but PIN was never set (iOS killed page
        // before PIN setup), the vault marker exists but no encrypted blob.
        // In that case, fall through to 'none' so the user can re-register/recover.
        let idbCheckCancelled = false;
        (async () => {
          try {
            const result = await checkVaultExistsInIDB(userId);
            if (idbCheckCancelled) return;
            if (result.exists) {
              setVaultState('locked');
            } else {
              // Vault marker set during registration but PIN never set — clear stale marker.
              localStorage.removeItem(`${VAULT_USER_KEY_PREFIX}${userId}`);
              setVaultState('none');
            }
          } catch {
            if (!idbCheckCancelled) setVaultState('locked'); // Fallback: assume vault exists.
          }
          if (!idbCheckCancelled) setLoading(false);
        })();
        return () => { idbCheckCancelled = true; };
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
          setNeedsPinSetupState(false);
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

          if (vaultPublicKeyHex) {
            // Vault exists. Check if we can auto-unlock using the derived AES
            // key stored in sessionStorage from a previous PIN entry. This
            // avoids re-prompting for PIN on every page refresh.
            const storedDerivedKey = sessionStorage.getItem(VAULT_DERIVED_KEY);

            if (sessionAlive && storedDerivedKey) {
              // Session is alive (not a browser restart) and we have the
              // derived key — attempt auto-unlock.
              try {
                const db = await openVaultStore(u.id);
                const blob = await loadEncryptedKey(db);
                db.close();

                if (blob && !cancelled) {
                  const privateKey = await decryptVaultWithRawKey(blob, storedDerivedKey);
                  if (cancelled) return;
                  const publicKey = vaultPublicKeyHex ? hexToBytes(vaultPublicKeyHex) : null;
                  identityKeyRef.current = { privateKey, publicKey };
                  clearPinSetup();
                  setVaultState('unlocked');
                  applyVaultTimeout(u.id);
                } else if (!cancelled) {
                  // Vault blob missing — PIN was never set. Clear stale marker.
                  sessionStorage.removeItem(VAULT_DERIVED_KEY);
                  localStorage.removeItem(`${VAULT_USER_KEY_PREFIX}${u.id}`);
                  setVaultState('unlocked');
                }
              } catch {
                // Derived key invalid or vault corrupt — fall back to PIN.
                if (!cancelled) {
                  sessionStorage.removeItem(VAULT_DERIVED_KEY);
                  clearPinSetup();
                  setVaultState('locked');
                }
              }
            } else {
              // No derived key or session flag absent — verify the vault blob
              // actually exists before showing PIN screen. The vault marker
              // (public key hex) is written during registration, but the
              // encrypted blob is only created when the user sets a PIN. If
              // they skipped PIN setup, the marker exists but the vault is empty.
              try {
                const db = await openVaultStore(u.id);
                const blob = await loadEncryptedKey(db);
                db.close();
                if (cancelled) return;
                if (blob) {
                  clearPinSetup();
                  setVaultState('locked');
                } else {
                  // Stale marker — PIN was never set. Clear it.
                  localStorage.removeItem(`${VAULT_USER_KEY_PREFIX}${u.id}`);
                  setVaultState('unlocked');
                }
              } catch {
                if (!cancelled) {
                  clearPinSetup();
                  setVaultState('locked');
                }
              }
            }
          } else {
            // Authenticated via JWT but no vault set up yet (PIN never configured).
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
  }, [clearPinSetup]);

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

  // ── Inactivity cleanup on vault lock / guest timer cleanup on unmount ──────

  useEffect(() => {
    if (vaultState !== 'unlocked') {
      clearVaultTimeoutEffects();
    }
  }, [vaultState, clearVaultTimeoutEffects]);

  useEffect(() => {
    return () => {
      // Cancel guest timers when the hook unmounts (e.g. during tests or
      // full page navigation) to prevent state updates on unmounted components.
      clearGuestTimers();
    };
  }, [clearGuestTimers]);

  // ── BroadcastChannel logout listener ─────────────────────────────────────

  useEffect(() => {
    let bc;
    try {
      bc = new BroadcastChannel('hush_auth');
      bc.onmessage = (event) => {
        if (event.data?.type === 'hush_logout') {
          identityKeyRef.current = null;
          clearVaultTimeoutEffects();
          setToken(null);
          setUser(null);
          setVaultState('none');
          clearPinSetup();
        }
      };
    } catch {
      // BroadcastChannel unavailable.
    }
    return () => { try { bc?.close(); } catch { /* noop */ } };
  }, [clearPinSetup, clearVaultTimeoutEffects]);

  return {
    user,
    token,
    vaultState,
    isAuthenticated,
    loading,
    error,
    needsPinSetup,
    performChallengeResponse,
    performRegister,
    performRecovery,
    completeDeviceLink,
    performGuestAuth,
    unlockVault,
    lockVault,
    setPIN,
    updateVaultTimeout,
    skipPinSetup,
    performLogout,
    clearError,
    // Ref to the in-memory identity keypair. Used by useInstances for
    // challenge-response auth on remote instances. Never serialized.
    identityKeyRef,
    // Transparency log error state. Set externally by ServerLayout when
    // TransparencyVerifier.verifyOwnKey() detects a key mismatch.
    // Non-null value blocks the app UI (hard-fail policy).
    transparencyError,
    setTransparencyError,
    // Guest session state. isGuest=true for ephemeral guest sessions;
    // guestExpiresAt is an ISO timestamp string for countdown display.
    isGuest,
    guestExpiresAt,
    // Voice disconnect hook. Voice components should set:
    //   voiceDisconnectRef.current = () => room.disconnect()
    // and clear it on unmount. Used by guest expiry to clean up the call.
    voiceDisconnectRef,
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
