/**
 * useInstances — central orchestration hook for multi-instance connections.
 *
 * Manages N simultaneous Hush instance connections in parallel. On mount,
 * it boots all known instances from IDB. Each boot performs:
 *   1. Handshake (public, no auth)
 *   2. Ed25519 challenge-response auth -> JWT
 *   3. Auto-register if the key is unknown to that instance
 *   4. WS connection with reconnect/backoff
 *   5. Guild fetch (stamped with instanceUrl)
 *
 * State is maintained per-instance and derives a merged guild array ordered
 * by the user's persisted preference from IDB.
 *
 * @module useInstances
 */

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from 'react';

import { useAuth } from '../contexts/AuthContext.jsx';
import { createWsClient } from '../lib/ws.js';
import {
  openInstanceRegistry,
  saveInstance,
  getAllInstances,
  removeInstance,
  saveGuildOrder,
  getGuildOrder,
} from '../lib/instanceRegistry.js';
import { getActiveAuthInstanceUrlSync } from '../lib/authInstanceStore.js';
import {
  getHandshake,
  requestChallenge,
  verifyChallenge,
  registerWithPublicKey,
  getMyGuilds,
  fetchWithAuth,
} from '../lib/api.js';
import { signChallenge } from '../lib/bip39Identity.js';
import { getDeviceId } from './useAuth.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 60_000;
const RECONNECT_MULTIPLIER = 2;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Converts a Uint8Array to a base64 string.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function toBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

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

/**
 * Converts an http(s) URL to a ws(s) URL for WS connection.
 * @param {string} url
 * @returns {string}
 */
function toWsUrl(url) {
  return url.replace(/^http/, 'ws') + '/ws';
}

// ── Main hook ─────────────────────────────────────────────────────────────────

/**
 * Manages N parallel Hush instance connections, merged guild array, and
 * per-instance auth state.
 *
 * @returns {{
 *   instanceStates: Map<string, InstanceState>,
 *   mergedGuilds: Array<object>,
 *   bootInstance: (instanceUrl: string) => Promise<void>,
 *   disconnectInstance: (instanceUrl: string) => Promise<void>,
 *   getWsClient: (instanceUrl: string) => object|null,
 *   getTokenForInstance: (instanceUrl: string) => string|null,
 *   guildOrder: string[],
 *   setGuildOrder: (ids: string[]) => Promise<void>,
 *   refreshGuilds: (instanceUrl: string) => Promise<void>,
 * }}
 */
export function useInstances() {
  const { identityKeyRef, user: localUser } = useAuth();

  /**
   * Per-instance runtime state stored in a ref (avoids stale closure issues
   * in WS callbacks). Shape per entry:
   * {
   *   wsClient,       // WS client object from createWsClient
   *   jwt,            // Current JWT string
   *   userId,         // User ID on this instance
   *   handshakeData,  // Last handshake response
   *   guilds,         // Array of guild objects stamped with instanceUrl
   *   connectionState, // 'connecting'|'connected'|'reconnecting'|'offline'
   *   reconnectAttempt, // Backoff counter
   *   reconnectTimer,   // Timer handle for backoff scheduling
   * }
   * @type {React.MutableRefObject<Map<string, object>>}
   */
  const instancesRef = useRef(new Map());

  /**
   * React state mirror of instancesRef used for rendering.
   * We keep a snapshot Map in state so consumers re-render on changes.
   * @type {[Map<string, InstanceState>, Function]}
   */
  const [instanceStates, setInstanceStates] = useState(new Map());

  /**
   * Persisted guild order from IDB (array of guild IDs).
   * @type {[string[], Function]}
   */
  const [guildOrder, _setGuildOrderState] = useState([]);

  /** IDB handle, opened once on mount. */
  const dbRef = useRef(null);

  // ── Metadata extraction helper ──────────────────────────────────────────

  /** Stamp guilds with instanceUrl and extract names from base64 metadata. */
  const stampGuilds = (guilds, instanceUrl) =>
    guilds.map(g => {
      const stamped = { ...g, instanceUrl };
      if (!stamped.name && stamped.encryptedMetadata) {
        try {
          const decoded = new TextDecoder().decode(
            Uint8Array.from(atob(stamped.encryptedMetadata), c => c.charCodeAt(0))
          );
          const parsed = JSON.parse(decoded);
          stamped.name = parsed.n || parsed.name || '';
        } catch { /* encrypted blob — needs MLS key */ }
      }
      return stamped;
    });

  // ── State snapshot helper ────────────────────────────────────────────────

  /**
   * Commits current instancesRef state to React state for re-render.
   * Called after any mutation to per-instance state.
   */
  const flushState = useCallback(() => {
    const snapshot = new Map();
    for (const [url, data] of instancesRef.current) {
      snapshot.set(url, {
        connectionState: data.connectionState,
        jwt: data.jwt,
        userId: data.userId,
        guilds: data.guilds,
        handshakeData: data.handshakeData,
      });
    }
    setInstanceStates(snapshot);
  }, []);

  // ── Guild order management ────────────────────────────────────────────────

  /**
   * Persists a new guild order to IDB and updates local state.
   * @param {string[]} ids - Ordered array of guild IDs.
   */
  const setGuildOrder = useCallback(async (ids) => {
    _setGuildOrderState(ids);
    if (dbRef.current) {
      await saveGuildOrder(dbRef.current, ids).catch(err => {
        console.error('[useInstances] saveGuildOrder failed:', err);
      });
    }
  }, []);

  // ── mergedGuilds derivation ───────────────────────────────────────────────

  /**
   * Memoised DM guild array across all instances.
   * Contains only guilds where isDm === true; separated from the regular sidebar list.
   */
  const dmGuilds = useMemo(() => {
    const all = [];
    for (const data of instancesRef.current.values()) {
      if (data.guilds) {
        all.push(...data.guilds.filter(g => g.isDm));
      }
    }
    return all;
    // NOTE: instanceStates is the trigger — recomputes when any instance state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceStates]);

  /**
   * Memoised merged guild array across all instances (excludes DM guilds).
   * Ordered guilds (from IDB preference) appear first; new guilds append.
   * DM guilds are filtered out so they do not appear in the regular guild icon sidebar.
   */
  const mergedGuilds = useMemo(() => {
    const allGuilds = [];
    for (const data of instancesRef.current.values()) {
      if (data.guilds) {
        allGuilds.push(...data.guilds.filter(g => !g.isDm));
      }
    }

    if (guildOrder.length === 0) return allGuilds;

    const orderIndex = new Map(guildOrder.map((id, i) => [id, i]));
    const ordered = [];
    const unordered = [];

    for (const guild of allGuilds) {
      if (orderIndex.has(guild.id)) {
        ordered.push(guild);
      } else {
        unordered.push(guild);
      }
    }

    ordered.sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));
    return [...ordered, ...unordered];
    // NOTE: instanceStates is the trigger — mergedGuilds recomputes when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceStates, guildOrder]);

  // ── WS reconnect logic ────────────────────────────────────────────────────

  /**
   * Starts an exponential backoff reconnect for an instance.
   * Increments connectionState to 'reconnecting' and schedules re-boot.
   * @param {string} instanceUrl
   */
  const scheduleReconnect = useCallback((instanceUrl) => {
    const entry = instancesRef.current.get(instanceUrl);
    if (!entry) return;

    // Clear any existing timer.
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
    }

    const attempt = entry.reconnectAttempt ?? 0;
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(RECONNECT_MULTIPLIER, attempt),
      RECONNECT_MAX_MS,
    );

    entry.connectionState = 'reconnecting';
    entry.reconnectAttempt = attempt + 1;
    entry.reconnectTimer = setTimeout(() => {
      entry.reconnectTimer = null;
      // Re-run bootInstance, ignoring errors (it will retry via close handler).
      bootInstance(instanceUrl).catch(() => undefined);
    }, delay);

    flushState();
  }, [flushState]); // bootInstance added via closure — intentional late binding

  // ── Per-instance WS event wiring ──────────────────────────────────────────

  /**
   * Attaches WS event handlers for an instance's WS client.
   * Handles guild-mutation events and unexpected disconnects.
   *
   * @param {string} instanceUrl
   * @param {object} wsClient - WS client from createWsClient
   */
  const wireWsHandlers = useCallback((instanceUrl, wsClient) => {
    wsClient.on('close', () => {
      const entry = instancesRef.current.get(instanceUrl);
      // Only reconnect if the instance is still registered and was connected.
      if (!entry) return;
      scheduleReconnect(instanceUrl);
    });

    // Handle guild-level WS events that require a guild list refresh.
    const refreshOnEvent = async () => {
      const entry = instancesRef.current.get(instanceUrl);
      if (!entry?.jwt) return;
      try {
        const guilds = await getMyGuilds(entry.jwt, instanceUrl);
        entry.guilds = guilds.map(g => ({ ...g, instanceUrl }));
        flushState();
      } catch (err) {
        console.error(`[useInstances] guild refresh failed for ${instanceUrl}:`, err);
      }
    };

    wsClient.on('server_updated', refreshOnEvent);
    wsClient.on('server_deleted', refreshOnEvent);
    wsClient.on('member_joined', refreshOnEvent);

    // After member_left, refresh guilds then silently disconnect if the user
    // has no remaining servers on this instance (auto-cleanup, no confirmation).
    const handleMemberLeft = async () => {
      await refreshOnEvent();
      const entry = instancesRef.current.get(instanceUrl);
      if (entry && (!entry.guilds || entry.guilds.length === 0)) {
        disconnectInstance(instanceUrl).catch((err) => {
          console.warn(`[useInstances] auto-disconnect failed for ${instanceUrl}:`, err);
        });
      }
    };
    wsClient.on('member_left', handleMemberLeft);
  }, [scheduleReconnect, flushState]); // disconnectInstance added via closure — stable ref

  // ── bootInstance ──────────────────────────────────────────────────────────

  /**
   * Authenticates and connects to an instance via challenge-response then WS.
   *
   * Steps:
   *   1. Set connectionState = 'connecting'
   *   2. getHandshake (public)
   *   3. requestChallenge -> sign -> verifyChallenge -> JWT
   *   4. Auto-register on 404 (unknown key)
   *   5. saveInstance to IDB
   *   6. createWsClient + connect
   *   7. getMyGuilds -> stamp with instanceUrl -> merge
   *   8. Set connectionState = 'connected'
   *
   * @param {string} instanceUrl - Canonical base URL (e.g. https://a.example.com)
   * @returns {Promise<void>}
   */
  const bootInstance = useCallback(async (instanceUrl) => {
    const identityKey = identityKeyRef?.current;
    if (!identityKey) {
      throw new Error('bootInstance: no identity key available — vault must be unlocked');
    }

    // Initialise or update entry in instancesRef.
    const existing = instancesRef.current.get(instanceUrl) ?? {};
    instancesRef.current.set(instanceUrl, {
      ...existing,
      connectionState: 'connecting',
      reconnectAttempt: existing.reconnectAttempt ?? 0,
      reconnectTimer: existing.reconnectTimer ?? null,
      guilds: existing.guilds ?? [],
    });
    flushState();

    try {
      // Step 1: Handshake (public, no auth).
      const handshakeData = await getHandshake(instanceUrl);

      // Step 2: Auth.
      const { privateKey, publicKey } = identityKey;
      const publicKeyBase64 = toBase64(publicKey);
      const deviceId = getDeviceId();
      const displayName = localUser?.username ?? 'user';

      let jwt;
      let authUser;

      try {
        const { nonce } = await requestChallenge(publicKeyBase64, instanceUrl);
        const nonceBytes = hexToBytes(nonce);
        const signature = await signChallenge(nonceBytes, privateKey);
        const signatureBase64 = toBase64(signature);
        const result = await verifyChallenge(publicKeyBase64, nonce, signatureBase64, deviceId, instanceUrl);
        jwt = result.token;
        authUser = result.user;
      } catch (err) {
        // 404 means the key is unknown on this instance — auto-register.
        const isNotFound = err?.status === 404 || err?.message?.includes('404');
        if (!isNotFound) throw err;

        const result = await registerWithPublicKey(
          displayName,
          displayName,
          publicKeyBase64,
          deviceId,
          null,
          instanceUrl,
        );
        jwt = result.token;
        authUser = result.user;
      }

      // Step 3: Persist to IDB.
      const db = dbRef.current;
      if (db) {
        await saveInstance(db, {
          instanceUrl,
          jwt,
          userId: authUser?.id,
          username: authUser?.username,
          connectionState: 'connected',
          lastSeen: Date.now(),
        });
      }

      // Step 4: Create and connect WS client. Close any existing WS first.
      const entry = instancesRef.current.get(instanceUrl);
      if (entry?.wsClient) {
        try { entry.wsClient.disconnect(); } catch { /* noop */ }
      }

      const wsClient = createWsClient({
        url: toWsUrl(instanceUrl),
        getToken: () => instancesRef.current.get(instanceUrl)?.jwt ?? null,
      });

      wireWsHandlers(instanceUrl, wsClient);
      wsClient.connect();

      // Step 5: Fetch guilds, extract names from metadata, and stamp with instanceUrl.
      const guilds = await getMyGuilds(jwt, instanceUrl);
      const stampedGuilds = stampGuilds(guilds, instanceUrl);

      // Step 6: Update entry.
      instancesRef.current.set(instanceUrl, {
        wsClient,
        jwt,
        userId: authUser?.id,
        handshakeData,
        guilds: stampedGuilds,
        connectionState: 'connected',
        reconnectAttempt: 0,
        reconnectTimer: null,
      });

      flushState();
    } catch (err) {
      // Mark as offline but keep entry so reconnect can retry.
      const entry = instancesRef.current.get(instanceUrl);
      if (entry) {
        entry.connectionState = 'offline';
        flushState();
      }
      console.error(`[useInstances] bootInstance failed for ${instanceUrl}:`, err);
      throw err;
    }
  }, [identityKeyRef, localUser, flushState, wireWsHandlers]);

  // ── disconnectInstance ────────────────────────────────────────────────────

  /**
   * Closes the WS connection, removes the instance from IDB, and clears state.
   *
   * @param {string} instanceUrl
   * @returns {Promise<void>}
   */
  const disconnectInstance = useCallback(async (instanceUrl) => {
    const entry = instancesRef.current.get(instanceUrl);
    if (!entry) return;

    // Cancel any pending reconnect timer.
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
    }

    // Disconnect WS.
    try { entry.wsClient?.disconnect(); } catch { /* noop */ }

    // Remove from IDB.
    const db = dbRef.current;
    if (db) {
      await removeInstance(db, instanceUrl).catch(err => {
        console.error('[useInstances] removeInstance failed:', err);
      });
    }

    // Remove from in-memory map and flush.
    instancesRef.current.delete(instanceUrl);
    flushState();
  }, [flushState]);

  // ── refreshGuilds ─────────────────────────────────────────────────────────

  /**
   * Re-fetches the guild list for a connected instance.
   * Updates mergedGuilds with the fresh list.
   *
   * @param {string} instanceUrl
   * @returns {Promise<void>}
   */
  const refreshGuilds = useCallback(async (instanceUrl) => {
    const entry = instancesRef.current.get(instanceUrl);
    if (!entry?.jwt) return;

    try {
      const guilds = await getMyGuilds(entry.jwt, instanceUrl);
      entry.guilds = stampGuilds(guilds, instanceUrl);
      flushState();
    } catch (err) {
      console.error(`[useInstances] refreshGuilds failed for ${instanceUrl}:`, err);
      throw err;
    }
  }, [flushState]);

  // ── registerLocalInstance (post-auth shortcut) ──────────────────────────

  /**
   * Registers the active auth instance as a connected instance using an existing JWT.
   * Skips challenge-response auth — used after registration/recovery when
   * the caller already has a valid session.
   *
   * @param {string} jwt - Existing JWT token
   * @param {{ id: string, username: string }} authUser - Authenticated user
   * @returns {Promise<void>}
   */
  const registerLocalInstance = useCallback(async (jwt, authUser) => {
    const instanceUrl = getActiveAuthInstanceUrlSync();

    // Save to IDB.
    try {
      const db = dbRef.current ?? await openInstanceRegistry();
      if (!dbRef.current) dbRef.current = db;
      await saveInstance(db, {
        instanceUrl,
        jwt,
        userId: authUser?.id,
        username: authUser?.username,
        connectionState: 'connected',
        lastSeen: Date.now(),
      });
    } catch (err) {
      console.warn('[useInstances] registerLocalInstance IDB save failed:', err);
    }

    // Create WS connection.
    const existing = instancesRef.current.get(instanceUrl);
    if (existing?.wsClient) {
      try { existing.wsClient.disconnect(); } catch { /* noop */ }
    }

    const wsClient = createWsClient({
      url: toWsUrl(instanceUrl),
      getToken: () => instancesRef.current.get(instanceUrl)?.jwt ?? null,
    });
    wireWsHandlers(instanceUrl, wsClient);
    wsClient.connect();

    // Fetch guilds.
    let guilds = [];
    try {
      const raw = await getMyGuilds(jwt, instanceUrl);
      guilds = stampGuilds(raw, instanceUrl);
    } catch { /* no guilds yet — that's fine after fresh registration */ }

    instancesRef.current.set(instanceUrl, {
      wsClient,
      jwt,
      userId: authUser?.id,
      handshakeData: null,
      guilds,
      connectionState: 'connected',
      reconnectAttempt: 0,
      reconnectTimer: null,
    });

    flushState();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flushState, wireWsHandlers]);

  // ── Accessor functions ────────────────────────────────────────────────────

  /**
   * Returns the WS client for an instance, or null if not connected.
   * @param {string} instanceUrl
   * @returns {object|null}
   */
  const getWsClient = useCallback((instanceUrl) => {
    return instancesRef.current.get(instanceUrl)?.wsClient ?? null;
  }, []);

  /**
   * Returns the current JWT for an instance, or null if not connected.
   * @param {string} instanceUrl
   * @returns {string|null}
   */
  const getTokenForInstance = useCallback((instanceUrl) => {
    return instancesRef.current.get(instanceUrl)?.jwt ?? null;
  }, []);

  // ── Mount: load instances and boot in parallel ────────────────────────────

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const db = await openInstanceRegistry();
        if (cancelled) return;

        dbRef.current = db;

        const [storedInstances, storedOrder] = await Promise.all([
          getAllInstances(db),
          getGuildOrder(db),
        ]);

        if (cancelled) return;

        if (storedOrder.length > 0) {
          _setGuildOrderState(storedOrder);
        }

        const localJwt = sessionStorage.getItem('hush_jwt');
        if (storedInstances.length === 0) {
          if (!localJwt) {
            // No instances yet — nothing to boot.
            flushState();
            return;
          }
          if (localUser?.id) {
            await registerLocalInstance(localJwt, { id: localUser.id, username: localUser.username });
            return;
          }
        }

        // Boot all stored instances in parallel.
        const results = await Promise.allSettled(
          storedInstances.map(({ instanceUrl }) => bootInstance(instanceUrl)),
        );

        // Fallback: if bootInstance failed (no identity key after page refresh)
        // but a local JWT exists in sessionStorage, use it directly for the
        // active auth instance.
        if (localJwt && !cancelled) {
          const localUrl = getActiveAuthInstanceUrlSync();
          const localEntry = instancesRef.current.get(localUrl);
          if (!localEntry || localEntry.connectionState === 'offline') {
            try {
              const res = await fetchWithAuth(localJwt, '/api/auth/me');
              if (res.ok) {
                const u = await res.json();
                if (!cancelled) {
                  await registerLocalInstance(localJwt, { id: u.id, username: u.username });
                }
              }
            } catch {
              // JWT invalid or network error — will show empty state.
            }
          }
        }
      } catch (err) {
        console.error('[useInstances] mount failed:', err);
      }
    })();

    return () => {
      cancelled = true;
      // Disconnect all WS clients on unmount.
      for (const entry of instancesRef.current.values()) {
        if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
        try { entry.wsClient?.disconnect(); } catch { /* noop */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    instanceStates,
    mergedGuilds,
    dmGuilds,
    bootInstance,
    registerLocalInstance,
    disconnectInstance,
    getWsClient,
    getTokenForInstance,
    guildOrder,
    setGuildOrder,
    refreshGuilds,
  };
}
