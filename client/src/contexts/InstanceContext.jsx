/**
 * InstanceContext — React context providing multi-instance state app-wide.
 *
 * This is a thin wrapper around useInstances. All business logic lives in the
 * hook; the context just makes it available without prop drilling.
 *
 * Usage:
 *   - Wrap the app (or a subtree) with <InstanceProvider>
 *   - Consume with useInstanceContext() in any child component
 *
 * Note: InstanceProvider should be mounted inside AuthProvider (it calls
 * useAuth internally via useInstances). Mounting in App.jsx is handled in
 * Plan 04 to avoid routing file conflicts.
 */

import { createContext, useContext } from 'react';
import { useInstances } from '../hooks/useInstances.js';

export const InstanceContext = createContext(null);

/**
 * Provides multi-instance connection state to the component tree.
 * Must be mounted inside AuthProvider.
 *
 * @param {{ children: React.ReactNode }} props
 */
export function InstanceProvider({ children }) {
  const instances = useInstances();
  return (
    <InstanceContext.Provider value={instances}>
      {children}
    </InstanceContext.Provider>
  );
}

/**
 * Returns the multi-instance state from the nearest InstanceProvider.
 * Throws if used outside an InstanceProvider — always mount InstanceProvider
 * high in the tree (wrapping all guild/channel components).
 *
 * @returns {ReturnType<typeof useInstances>}
 */
export function useInstanceContext() {
  const ctx = useContext(InstanceContext);
  if (!ctx) {
    throw new Error('useInstanceContext must be used within InstanceProvider');
  }
  return ctx;
}
