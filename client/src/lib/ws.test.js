import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWsClient } from './ws';

describe('createWsClient', () => {
  let MockWs;
  let openCb;
  let messageCb;

  beforeEach(() => {
    openCb = null;
    messageCb = null;
    MockWs = vi.fn(function MockWs(url) {
      this.url = url;
      this.readyState = 1;
      this.send = vi.fn();
      this.close = vi.fn();
      const self = this;
      setTimeout(() => {
        if (self.onopen) self.onopen();
      }, 0);
      return this;
    });
    MockWs.OPEN = 1;
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

  it('sends auth message when no token in URL', (done) => {
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
      done();
    }, 10);
  });

  it('dispatches incoming message by type to listeners', (done) => {
    let wsInstance;
    MockWs = vi.fn(function MockWs() {
      this.readyState = 1;
      this.send = vi.fn();
      this.close = vi.fn();
      wsInstance = this;
      return this;
    });
    MockWs.OPEN = 1;
    global.WebSocket = MockWs;

    const getToken = vi.fn(() => 't');
    const client = createWsClient({ url: 'ws://localhost/ws', getToken });
    const onMessageNew = vi.fn();
    client.on('message.new', onMessageNew);
    client.connect();
    setTimeout(() => {
      expect(wsInstance).toBeDefined();
      wsInstance.onmessage({ data: JSON.stringify({ type: 'message.new', id: 'm1', channel_id: 'ch1' }) });
      expect(onMessageNew).toHaveBeenCalledWith(expect.objectContaining({ type: 'message.new', id: 'm1', channel_id: 'ch1' }));
      done();
    }, 10);
  });

  it('send(type, payload) serializes and sends', (done) => {
    const getToken = vi.fn(() => 't');
    const client = createWsClient({ url: 'ws://localhost/ws', getToken });
    client.connect();
    setTimeout(() => {
      client.send('subscribe', { channel_id: 'ch1' });
      const sent = MockWs.mock.results[0].value.send.mock.calls[0][0];
      expect(JSON.parse(sent)).toEqual({ type: 'subscribe', channel_id: 'ch1' });
      done();
    }, 10);
  });

  it('off removes listener', (done) => {
    let wsInstance;
    MockWs = vi.fn(function MockWs() {
      this.readyState = 1;
      this.send = vi.fn();
      this.close = vi.fn();
      wsInstance = this;
      return this;
    });
    MockWs.OPEN = 1;
    global.WebSocket = MockWs;
    const getToken = vi.fn(() => 't');
    const client = createWsClient({ url: 'ws://localhost/ws', getToken });
    const onPresence = vi.fn();
    client.on('presence.update', onPresence);
    client.off('presence.update', onPresence);
    client.connect();
    setTimeout(() => {
      wsInstance.onmessage({ data: JSON.stringify({ type: 'presence.update', user_ids: [] }) });
      expect(onPresence).not.toHaveBeenCalled();
      done();
    }, 10);
  });
});
