/**
 * WebSocket client for the Go backend. JWT auth (query param or first message),
 * auto-reconnect with exponential backoff, message type routing via event emitter.
 *
 * Reconnect chain:
 *   disconnect detected -> backoff timer -> connect() -> re-auth via token in URL
 *   -> emit('open', { isReconnect: true }) -> onReconnected hook -> app handles
 *   message catch-up and MLS group state recovery -> emit('reconnected', {})
 */

const DEFAULT_WS_PATH = '/ws';
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const RECONNECT_MULTIPLIER = 2;

/**
 * @param {{ url?: string, getToken: () => string | null, onReconnected?: () => Promise<void> | void }} opts
 *   url: full WS URL (e.g. wss://host/ws) or base URL
 *   getToken: returns the current auth token (refreshed on each reconnect)
 *   onReconnected: optional async hook called after a successful reconnect.
 *     Use this to register MLS group state recovery and message catch-up logic.
 *     The hook is awaited before emitting 'reconnected'. Errors are logged and
 *     do not abort the reconnect.
 * @returns {{
 *   connect: () => void,
 *   disconnect: () => void,
 *   send: (type: string, payload: object) => void,
 *   on: (type: string, callback: (data: object) => void) => void,
 *   off: (type: string, callback: (data: object) => void) => void,
 *   isConnected: () => boolean,
 *   isReconnecting: () => boolean,
 * }}
 */
export function createWsClient(opts) {
  const getToken = opts.getToken;
  const onReconnected = opts.onReconnected ?? null;
  let wsUrl = opts.url;
  if (!wsUrl && typeof location !== 'undefined') {
    const base = location.origin.replace(/^http/, 'ws');
    wsUrl = `${base}${DEFAULT_WS_PATH}`;
  }
  if (!wsUrl) {
    throw new Error('ws url required (or use in browser for default)');
  }

  /** @type {WebSocket | null} */
  let socket = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  /** @type {Map<string, Set<(data: object) => void>>} */
  const listeners = new Map();
  let authSent = false;
  /**
   * True while a reconnect is scheduled or in progress (between onclose and
   * the completion of the onReconnected hook). The UI can poll isReconnecting()
   * or listen for the 'reconnecting' and 'reconnected' events.
   */
  let reconnecting = false;

  function emit(type, data) {
    const cbs = listeners.get(type);
    if (cbs) {
      cbs.forEach((cb) => {
        try {
          cb(data);
        } catch (e) {
          console.error('[ws] listener error', type, e);
        }
      });
    }
    const any = listeners.get('*');
    if (any) {
      any.forEach((cb) => {
        try {
          cb({ type, ...data });
        } catch (e) {
          console.error('[ws] listener error *', e);
        }
      });
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnecting = true;
    emit('reconnecting', {});
    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(RECONNECT_MULTIPLIER, reconnectAttempt), RECONNECT_MAX_MS);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect() {
    // readyState 1 === OPEN, 0 === CONNECTING. Avoid global WebSocket reference.
    if (socket && (socket.readyState === 1 || socket.readyState === 0)) return;
    // Always embed a fresh token in the URL so the reconnected session is
    // immediately authenticated without a separate message round-trip.
    const token = getToken();
    const urlWithToken = token ? `${wsUrl}?token=${encodeURIComponent(token)}` : wsUrl;
    const ws = new WebSocket(urlWithToken);
    socket = ws;
    authSent = !!token;
    const isReconnect = reconnectAttempt > 0 || reconnecting;

    ws.onopen = async () => {
      reconnectAttempt = 0;

      // Send auth message as fallback when token was not available at connect time.
      if (!authSent && getToken()) {
        authSent = true;
        ws.send(JSON.stringify({ type: 'auth', token: getToken() }));
      }

      emit('open', { isReconnect });

      if (isReconnect) {
        // Run the application-registered recovery hook (message catch-up +
        // MLS group state recovery). Errors are non-fatal — the connection is
        // usable even if recovery partially fails.
        if (onReconnected) {
          try {
            await onReconnected();
          } catch (err) {
            console.error('[ws] onReconnected hook error', err);
          }
        }
        reconnecting = false;
        emit('reconnected', {});
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const type = data.type;
        if (type) emit(type, data);
      } catch (_) {
        // ignore non-JSON
      }
    };

    ws.onclose = () => {
      socket = null;
      authSent = false;
      emit('close', {});
      scheduleReconnect();
    };

    ws.onerror = () => {
      emit('error', {});
    };
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectAttempt = 0;
    reconnecting = false;
    if (socket) {
      // Detach handlers before closing so onclose doesn't trigger scheduleReconnect.
      const s = socket;
      socket = null;
      s.onmessage = null;
      s.onclose = null;
      s.onerror = null;
      if (s.readyState === 0 /* CONNECTING */) {
        // Calling close() on a CONNECTING socket causes a browser warning.
        // Instead, let it finish opening then immediately close it.
        s.onopen = () => s.close();
      } else {
        s.onopen = null;
        s.close();
      }
    }
    authSent = false;
  }

  function isConnected() {
    // readyState 1 === OPEN. Avoid referencing the global WebSocket to allow
    // environments (tests, SSR) where it may not be defined.
    return socket !== null && socket.readyState === 1;
  }

  function isReconnecting() {
    return reconnecting;
  }

  function send(type, payload = {}) {
    if (!isConnected()) return;
    socket.send(JSON.stringify({ type, ...payload }));
  }

  function on(type, callback) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(callback);
  }

  function off(type, callback) {
    const cbs = listeners.get(type);
    if (cbs) cbs.delete(callback);
  }

  return { connect, disconnect, send, isConnected, isReconnecting, on, off };
}
