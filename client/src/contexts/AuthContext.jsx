import { createContext, useContext } from 'react';
import { useMatrixAuth } from '../hooks/useMatrixAuth';

const AuthContext = createContext(null);

/**
 * Provides Matrix auth state and actions to the tree.
 * Mounting this provider runs rehydration from sessionStorage when needed.
 */
export function AuthProvider({ children }) {
  const auth = useMatrixAuth();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
