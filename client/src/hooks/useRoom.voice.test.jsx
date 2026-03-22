import { describe, it, expect } from 'vitest';

describe('useRoom MLS voice E2EE', () => {
  it('connectRoom creates or joins voice MLS group before connecting', () => {
    expect.fail('Wave 0 stub — implement in M.3-03');
  });

  it('connectRoom calls exportVoiceFrameKey and applies key via setKey', () => {
    expect.fail('Wave 0 stub — implement in M.3-03');
  });

  it('mls.commit WS event triggers key re-derivation with new epoch', () => {
    expect.fail('Wave 0 stub — implement in M.3-03');
  });

  it('disconnectRoom destroys local voice group state', () => {
    expect.fail('Wave 0 stub — implement in M.3-03');
  });

  it('periodic self_update rotates frame key on timer', () => {
    expect.fail('Wave 0 stub — implement in M.3-03');
  });

  it('MLS failure blocks voice entirely — no unencrypted fallback', () => {
    expect.fail('Wave 0 stub — implement in M.3-03');
  });

  it('isVoiceReconnecting is true during async MLS rejoin flow', () => {
    expect.fail('Wave 0 stub — implement in M.3-03');
  });
});
