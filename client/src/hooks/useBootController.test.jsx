/**
 * useBootController tests.
 *
 * Verifies the boot state machine derives the correct state from
 * useAuth (vault/session) and useInstances (guild loading).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../contexts/AuthContext.jsx', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../contexts/InstanceContext.jsx', () => ({
  useInstanceContext: vi.fn(),
}));

import { useAuth } from '../contexts/AuthContext.jsx';
import { useInstanceContext } from '../contexts/InstanceContext.jsx';
import { BootProvider, useBootController } from './useBootController.jsx';

function mockState({
  authLoading = false,
  vaultState = 'none',
  isAuthenticated = false,
  needsPinSetup = false,
  guildsLoaded = false,
} = {}) {
  useAuth.mockReturnValue({
    loading: authLoading,
    vaultState,
    isAuthenticated,
    needsPinSetup,
    user: isAuthenticated ? { id: 'u1' } : null,
  });
  useInstanceContext.mockReturnValue({ guildsLoaded, mergedGuilds: guildsLoaded ? [{ id: 'g1' }] : [] });
}

function wrapper({ children }) {
  return <BootProvider>{children}</BootProvider>;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useBootController', () => {
  it('returns loading while auth is rehydrating', () => {
    mockState({ authLoading: true });
    const { result } = renderHook(() => useBootController(), { wrapper });
    expect(result.current.bootState).toBe('loading');
  });

  it('returns needs_pin when vault is locked', () => {
    mockState({ vaultState: 'locked' });
    const { result } = renderHook(() => useBootController(), { wrapper });
    expect(result.current.bootState).toBe('needs_pin');
  });

  it('returns needs_login when not authenticated and no vault', () => {
    mockState({ vaultState: 'none', isAuthenticated: false });
    const { result } = renderHook(() => useBootController(), { wrapper });
    expect(result.current.bootState).toBe('needs_login');
  });

  it('returns ready when authenticated but guilds not loaded yet', () => {
    mockState({ vaultState: 'unlocked', isAuthenticated: true, guildsLoaded: false });
    const { result } = renderHook(() => useBootController(), { wrapper });
    expect(result.current.bootState).toBe('ready');
  });

  it('returns booted when authenticated and guilds loaded', () => {
    mockState({ vaultState: 'unlocked', isAuthenticated: true, guildsLoaded: true });
    const { result } = renderHook(() => useBootController(), { wrapper });
    expect(result.current.bootState).toBe('booted');
  });

  it('returns ready when vaultState=none but isAuthenticated (no PIN configured)', () => {
    mockState({ vaultState: 'none', isAuthenticated: true, guildsLoaded: false });
    const { result } = renderHook(() => useBootController(), { wrapper });
    expect(result.current.bootState).toBe('ready');
  });

  it('needs_pin takes priority over isAuthenticated=true', () => {
    mockState({ vaultState: 'locked', isAuthenticated: true });
    const { result } = renderHook(() => useBootController(), { wrapper });
    expect(result.current.bootState).toBe('needs_pin');
  });

  it('returns pin_setup when auth reports pending pin setup', () => {
    mockState({ vaultState: 'unlocked', isAuthenticated: true, needsPinSetup: true, guildsLoaded: true });
    const { result } = renderHook(() => useBootController(), { wrapper });
    expect(result.current.bootState).toBe('pin_setup');
  });

  it('needs_pin takes priority over pending pin setup', () => {
    mockState({ vaultState: 'locked', isAuthenticated: true, needsPinSetup: true, guildsLoaded: true });
    const { result } = renderHook(() => useBootController(), { wrapper });
    expect(result.current.bootState).toBe('needs_pin');
  });
});
