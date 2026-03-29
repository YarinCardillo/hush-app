/**
 * useBootController — single source of truth for the app startup sequence.
 *
 * Derives one atomic bootState from useAuth (vault/session/PIN-setup state)
 * and useInstances (guild loading). Every rendering decision in the app flows
 * from this state. No other component independently checks auth, vault, or
 * guild loading to decide what to display.
 *
 * Boot states (sequential, deterministic):
 *
 *   'loading'     — auth is rehydrating (IDB/JWT check in progress)
 *   'needs_login' — no session, no vault — show login/register
 *   'needs_pin'   — vault exists but locked — show PIN screen
 *   'pin_setup'   — just registered/recovered, PIN setup prompt before proceeding
 *   'ready'       — authenticated, identity key available, instances booting
 *   'booted'      — authenticated, instances connected, guilds loaded
 *
 * The BootController is exposed via context so AppContent can consume a single
 * boot-state value without duplicating auth/loading checks.
 *
 * @module useBootController
 */

import { createContext, useContext, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useInstanceContext } from '../contexts/InstanceContext.jsx';

const BootContext = createContext(null);

/**
 * Provider that runs the boot state machine. Mount inside AuthProvider and
 * InstanceProvider so the underlying hooks are available.
 *
 * @param {{ children: React.ReactNode }} props
 */
export function BootProvider({ children }) {
  const {
    loading: authLoading,
    vaultState,
    isAuthenticated,
    needsPinSetup,
    user,
  } = useAuth();

  const {
    guildsLoaded,
    mergedGuilds,
  } = useInstanceContext();

  const bootState = useMemo(() => {
    // Step 1: auth still rehydrating — block everything.
    if (authLoading) return 'loading';

    // Step 1b/2: vault locked — need PIN before anything else.
    if (vaultState === 'locked') return 'needs_pin';

    // No vault and not authenticated — need login/register.
    if (!isAuthenticated) return 'needs_login';

    // Authenticated. Check if post-registration PIN setup is pending.
    if (needsPinSetup) return 'pin_setup';

    // Step 3: wait for instance boot to finish.
    if (!guildsLoaded) return 'ready';

    return 'booted';
  }, [authLoading, vaultState, isAuthenticated, needsPinSetup, guildsLoaded]);

  const value = useMemo(() => ({
    bootState,
    user,
    mergedGuilds,
    guildsLoaded,
  }), [bootState, user, mergedGuilds, guildsLoaded]);

  return (
    <BootContext.Provider value={value}>
      {children}
    </BootContext.Provider>
  );
}

/**
 * Consumes the boot state from the nearest BootProvider.
 *
 * @returns {{
 *   bootState: 'loading' | 'needs_login' | 'needs_pin' | 'pin_setup' | 'ready' | 'booted',
 *   user: object | null,
 *   mergedGuilds: Array<object>,
 *   guildsLoaded: boolean,
 * }}
 */
export function useBootController() {
  const ctx = useContext(BootContext);
  if (!ctx) {
    throw new Error('useBootController must be used within BootProvider');
  }
  return ctx;
}
