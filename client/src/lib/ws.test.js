import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWsClient } from './ws';

// ── Shared mock factory ───────────────────────────────────────────────────────

/**
 * Builds a MockWs constructor whose instances:
 *   - fire onopen asynchronously (settimeout 0) by default
 *   - optionally capture the instance for direct manipulation
 */
function makeMockWs({ captureInstance = false, autoOpen = true } = {}) {
  let captured = null;
  const Ctor = vi.fn(function MockWs(url) {
    this.url = url;
    this.readyState = 1; // OPEN
    this.send = vi.fn();
    this.close = vi.fn();
    if (captureInstance) captured = this;
    const self = this;
    if (autoOpen) {
      setTimeout(() => { if (self.onopen) self.onopen(); }, 0);
    }
    return this;
  });
  Ctor.OPEN = 1;
  Ctor.CONNECTING = 0;
  Object.defineProperty(Ctor, 'captured', { get: () => captured });
  return Ctor;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createWsClient — initial connection', () => {
  let MockWs;

  beforeEach(() => {
    MockWs = makeMockWs();
    global.WebSocket = MockWs;
  });

  afterEach(() => {
    delete global.WebSocket;
  });

  it('connects with token in URL when getToken returns token', () => {
    const getToken = vi.fn(() => 'jwt-123');
    const client = createWsClient({ url: 'ws://localhost/ws', getToken });
    client.connect();
    expect(MockWs).toHaveBeenCalledWith('ws://localhost/ws?token=jwt-123');
    expect(getToken).toHaveBeenCalled();
  });

  it('sends auth message when no token in URL', () => new Promise((resolve) => {
    const getToken = vi.fn().mockReturnValueOnce(null).mockReturnValue('late-token');
    const client = createWsClient({ url: 'ws://localhost/ws', getToken });
    client.connect();
    expect(MockWs).toHaveBeenCalledWith('ws://localhost/ws');
    setTimeout(() => {
      expect(MockWs.mock.results[0].value.send).toHaveBeenCalled();
      const calls = MockWs.mock.results[0].value.send.mock.calls;
      const authCall = calls.find((c) => JSON.parse(c[0]).type === 'auth');
      expect(authCall).toBeDefined();
      expect(JSON.parse(authCall[0])).toEqual({ type: 'auth', token: 'late-token' });
      resolve();
    }, 10);
  }));

  it('dispatches incoming message by type to listeners', () => new Promise((resolve) => {
    MockWs = makeMockWs({ captureInstance: true, autoOpen: false });
    global.WebSocket = MockWs;

    const getToken = vi.fn(() => 't');
    const client = createWsClient({ url: 'ws://localhost/ws', getToken });
    const onMessageNew = vi.fn();
    client.on('message.new', onMessageNew);
    client.connect();
    setTimeout(() => {
      const ws = MockWs.captured;
      expect(ws).not.toBeNull();
      ws.onmessage({ data: JSON.stringify({ type: 'message.new', id: 'm1', channel_id: 'ch1' }) });
      expect(onMessageNew).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'message.new', id: 'm1', channel_id: 'ch1' }),
      );
      resolve();
    }, 10);
  }));

  it('send(type, payload) serializes and sends', () => new Promise((resolve) => {
    const getToken = vi.fn(() => 't');
    const client = createWsClient({ url: 'ws://localhost/ws', getToken });
    client.connect();
    setTimeout(() => {
      client.send('subscribe', { channel_id: 'ch1' });
      const sent = MockWs.mock.results[0].value.send.mock.calls[0][0];
      expect(JSON.parse(sent)).toEqual({ type: 'subscribe', channel_id: 'ch1' });
      resolve();
    }, 10);
  }));

  it('off removes listener', () => new Promise((resolve) => {
    MockWs = makeMockWs({ captureInstance: true, autoOpen: false });
    global.WebSocket = MockWs;
    const getToken = vi.fn(() => 't');
    const client = createWsClient({ url: 'ws://localhost/ws', getToken });
    const onPresence = vi.fn();
    client.on('presence.update', onPresence);
    client.off('presence.update', onPresence);
    client.connect();
    setTimeout(() => {
      MockWs.captured.onmessage({ data: JSON.stringify({ type: 'presence.update', user_ids: [] }) });
      expect(onPresence).not.toHaveBeenCalled();
      resolve();
    }, 10);
  }));
});

// ── Reconnect chain tests ─────────────────────────────────────────────────────

describe('createWsClient — reconnect chain', () => {
  let MockWs;

  beforeEach(() => {
    vi.useFakeTimers();
    MockWs = makeMockWs({ captureInstance: true, autoOpen: false });
    global.WebSocket = MockWs;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete global.WebSocket;
  });

  /**
   * Opens a connection, triggers the onopen callback, then simulates a close
   * and advances fake timers past the backoff delay to trigger reconnect.
   */
  async function openAndSimulateReconnect(client) {
    client.connect();
    // Fire first onopen.
    MockWs.captured.onopen && MockWs.captured.onopen();
    // Simulate disconnect.
    MockWs.captured.onclose && MockWs.captured.onclose();
    // Allow reconnect timer (1000ms base) to fire.
    vi.advanceTimersByTime(1100);
    // New WS instance created — fire its onopen.
    const second = MockWs.mock.results[1]?.value;
    if (second?.onopen) await second.onopen();
    return second;
  }

  it('emits "reconnecting" event on disconnect before reconnect attempt', async () => {
    const getToken = vi.fn(() => 'tok');
    const onReconnecting = vi.fn();
    const client = createWsClient({ url: 'ws://localhost/ws', getToken });
    client.on('reconnecting', onReconnecting);

    client.connect();
    MockWs.captured.onopen();
    MockWs.captured.onclose();

    expect(onReconnecting).toHaveBeenCalledOnce();
  });

  it('emits "reconnected" event after successful reconnect', async () => {
    const getToken = vi.fn(() => 'tok');
    const onReconnected = vi.fn();
    const client = createWsClient({ url: 'ws://localhost/ws', getToken });
    client.on('reconnected', onReconnected);

    await openAndSimulateReconnect(client);

    expect(onReconnected).toHaveBeenCalledOnce();
  });

  it('embeds fresh token in URL on reconnect', async () => {
    // Return different tokens on each call to simulate token refresh.
    const getToken = vi.fn().mockReturnValueOnce('tok-1').mockReturnValue('tok-2');
    const client = createWsClient({ url: 'ws://localhost/ws', getToken });

    client.connect();
    MockWs.captured.onopen();
    MockWs.captured.onclose();
    vi.advanceTimersByTime(1100);

    const secondUrl = MockWs.mock.calls[1]?.[0];
    expect(secondUrl).toContain('token=tok-2');
  });

  it('calls onReconnected hook after reconnect and before emitting "reconnected"', async () => {
    const callOrder = [];
    const onReconnectedHook = vi.fn(async () => {
      callOrder.push('hook');
    });
    const getToken = vi.fn(() => 'tok');
    const client = createWsClient({
      url: 'ws://localhost/ws',
      getToken,
      onReconnected: onReconnectedHook,
    });
    client.on('reconnected', () => callOrder.push('event'));

    await openAndSimulateReconnect(client);

    expect(onReconnectedHook).toHaveBeenCalledOnce();
    expect(callOrder).toEqual(['hook', 'event']);
  });

  it('isReconnecting() returns true between disconnect and reconnected hook completion', () => {
    const getToken = vi.fn(() => 'tok');
    const client = createWsClient({ url: 'ws://localhost/ws', getToken });

    client.connect();
    MockWs.captured.onopen();
    expect(client.isReconnecting()).toBe(false);

    MockWs.captured.onclose();
    expect(client.isReconnecting()).toBe(true);
  });

  it('isReconnecting() returns false after manual disconnect()', () => {
    const getToken = vi.fn(() => 'tok');
    const client = createWsClient({ url: 'ws://localhost/ws', getToken });

    client.connect();
    MockWs.captured.onopen();
    MockWs.captured.onclose();
    expect(client.isReconnecting()).toBe(true);

    client.disconnect();
    expect(client.isReconnecting()).toBe(false);
  });

  it('onReconnected hook error does not prevent "reconnected" event', async () => {
    const getToken = vi.fn(() => 'tok');
    const badHook = vi.fn(async () => { throw new Error('recovery failed'); });
    const onReconnectedEvent = vi.fn();
    const client = createWsClient({
      url: 'ws://localhost/ws',
      getToken,
      onReconnected: badHook,
    });
    client.on('reconnected', onReconnectedEvent);

    await openAndSimulateReconnect(client);

    // Event fires even when hook throws.
    expect(onReconnectedEvent).toHaveBeenCalledOnce();
  });
});
