import { describe, it, expect } from 'vitest';
import {
  openStore,
  getIdentity,
  setIdentity,
  getRegistrationId,
  setRegistrationId,
  getSession,
  setSession,
  getPreKeys,
  setPreKeys,
} from './signalStore';

describe('signalStore', () => {
  it('exports all store functions', () => {
    expect(typeof openStore).toBe('function');
    expect(typeof getIdentity).toBe('function');
    expect(typeof setIdentity).toBe('function');
    expect(typeof getRegistrationId).toBe('function');
    expect(typeof setRegistrationId).toBe('function');
    expect(typeof getSession).toBe('function');
    expect(typeof setSession).toBe('function');
    expect(typeof getPreKeys).toBe('function');
    expect(typeof setPreKeys).toBe('function');
  });

  it('openStore returns a promise', () => {
    const p = openStore('u', 'd');
    expect(p).toBeInstanceOf(Promise);
  });
});
