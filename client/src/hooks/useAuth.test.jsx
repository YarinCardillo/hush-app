import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { fetchWithAuth } from '../lib/api';

const JWT_KEY = 'hush_jwt';

vi.mock('../lib/api', () => ({
  fetchWithAuth: vi.fn(),
  uploadKeysAfterAuth: vi.fn().mockResolvedValue(undefined),
}));

function mockFetchOk(body) {
  return {
    ok: true,
    json: () => Promise.resolve(body),
  };
}

function TestConsumer() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="authenticated">{String(auth.isAuthenticated)}</span>
      <span data-testid="user-id">{auth.user?.id ?? ''}</span>
      <span data-testid="token">{auth.token ?? ''}</span>
      <button type="button" onClick={() => auth.login('alice', 'pass')}>Login</button>
      <button type="button" onClick={() => auth.logout()}>Logout</button>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <TestConsumer />
    </AuthProvider>
  );
}

describe('useAuth', () => {
  let originalFetch;

  beforeEach(() => {
    cleanup();
    originalFetch = globalThis.fetch;
    sessionStorage.clear();
    localStorage.clear();
    globalThis.fetch = vi.fn();
    vi.mocked(fetchWithAuth).mockReset();
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: false,
      status: 401,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('login stores token in sessionStorage and sets user', async () => {
    globalThis.fetch.mockResolvedValue(
      mockFetchOk({
        token: 'jwt-123',
        user: { id: 'user-1', username: 'alice', displayName: 'Alice' },
      })
    );

    const { getByRole, container } = render(<App />);
    await act(async () => {
      getByRole('button', { name: 'Login' }).click();
    });

    await waitFor(() => {
      expect(sessionStorage.getItem(JWT_KEY)).toBe('jwt-123');
    });
    await waitFor(() => {
      const auth = container.querySelector('[data-testid="authenticated"]');
      const userId = container.querySelector('[data-testid="user-id"]');
      expect(auth?.textContent).toBe('true');
      expect(userId?.textContent).toBe('user-1');
    });
  });

  it('logout clears token and user', async () => {
    globalThis.fetch.mockResolvedValue(
      mockFetchOk({
        token: 'jwt-456',
        user: { id: 'user-2', username: 'bob', displayName: 'Bob' },
      })
    );

    const { getByRole, container } = render(<App />);

    await act(async () => {
      getByRole('button', { name: 'Login' }).click();
    });

    await waitFor(() => {
      expect(sessionStorage.getItem(JWT_KEY)).toBe('jwt-456');
    });

    vi.mocked(fetchWithAuth).mockResolvedValue({ ok: true, status: 204 });

    await act(async () => {
      getByRole('button', { name: 'Logout' }).click();
    });

    await waitFor(() => {
      expect(sessionStorage.getItem(JWT_KEY)).toBeNull();
      const auth = container.querySelector('[data-testid="authenticated"]');
      expect(auth?.textContent).toBe('false');
    });
  });

  it('rehydration on mount with valid token sets user', async () => {
    sessionStorage.setItem(JWT_KEY, 'stored-jwt');

    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'user-3',
          username: 'charlie',
          displayName: 'Charlie',
        }),
    });

    const { container } = render(<App />);

    await waitFor(() => {
      const auth = container.querySelector('[data-testid="authenticated"]');
      const userId = container.querySelector('[data-testid="user-id"]');
      expect(auth?.textContent).toBe('true');
      expect(userId?.textContent).toBe('user-3');
    });
  });

  it('rehydration with invalid token clears token', async () => {
    sessionStorage.setItem(JWT_KEY, 'bad-jwt');

    vi.mocked(fetchWithAuth).mockResolvedValue({ ok: false, status: 401 });

    const { container } = render(<App />);

    await waitFor(() => {
      expect(sessionStorage.getItem(JWT_KEY)).toBeNull();
      const auth = container.querySelector('[data-testid="authenticated"]');
      expect(auth?.textContent).toBe('false');
    });
  });
});
