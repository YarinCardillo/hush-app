/**
 * WebSocket client for the Go backend. JWT auth (query param or first message),
 * auto-reconnect with exponential backoff, message type routing via event emitter.
 */

const DEFAULT_WS_PATH = '/ws';
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const RECONNECT_MULTIPLIER = 2;

/**
 * @param {{ url?: string, getToken: () => string | null }} opts - url: full WS URL (e.g. wss://host/ws) or base URL; getToken for auth message when token not in URL
 * @returns {{ connect: () => void, disconnect: () => void, send: (type: string, payload: object) => void, on: (type: string, callback: (data: object) => void) => void, off: (type: string, callback: (data: object) => void) => void }}
 */
export function createWsClient(opts) {
  const getToken = opts.getToken;
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
    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(RECONNECT_MULTIPLIER, reconnectAttempt), RECONNECT_MAX_MS);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect() {
    if (socket && socket.readyState === WebSocket.OPEN) return;
    const urlWithToken = getToken() ? `${wsUrl}?token=${encodeURIComponent(getToken())}` : wsUrl;
    const ws = new WebSocket(urlWithToken);
    socket = ws;
    authSent = !!getToken();

    ws.onopen = () => {
      reconnectAttempt = 0;
      if (!authSent && getToken()) {
        authSent = true;
        ws.send(JSON.stringify({ type: 'auth', token: getToken() }));
      }
      emit('open', {});
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
    if (socket) {
      socket.close();
      socket = null;
    }
    authSent = false;
  }

  function isConnected() {
    return socket !== null && socket.readyState === WebSocket.OPEN;
  }

  function send(type, payload = {}) {
    if (!isConnected()) {
      throw new Error('WebSocket not connected');
    }
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

  return { connect, disconnect, send, isConnected, on, off };
}
