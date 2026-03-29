/**
 * App.test.jsx — Two-tab detection via BroadcastChannel
 *
 * Tests the useSingleTab hook behavior:
 * 1. isBlockedTab becomes true when session_active is received within 500ms of session_ping
 * 2. isBlockedTab remains false when no session_active received within 500ms (tab is primary)
 * 3. isBlockedTab becomes true when session_takeover is received (old tab yields)
 * 4. BroadcastChannel unavailability degrades gracefully (isBlockedTab = false, app renders)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Mock all heavy dependencies that App.jsx transitively pulls in.
// These mocks must appear BEFORE the App/useSingleTab imports so the factory
// functions run first (Vitest hoists vi.mock() calls to the top of the file).
// ---------------------------------------------------------------------------

vi.mock('./contexts/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({ vaultState: 'locked', isAuthenticated: false, loading: false }),
}));

vi.mock('./contexts/InstanceContext', () => ({
  InstanceProvider: ({ children }) => children,
}));

vi.mock('./components/AppBackground', () => ({ default: () => null }));

vi.mock('./components/UserSettingsModal', () => ({
  applyThemeMode: vi.fn(),
  getStoredThemeMode: vi.fn().mockReturnValue('dark'),
}));

// Mock useSingleTab so we can control the blocked-tab state in App tests
vi.mock('./hooks/useSingleTab', () => ({
  useSingleTab: vi.fn(() => ({ isBlockedTab: false, takeOver: vi.fn() })),
}));

// jsdom doesn't implement matchMedia — provide a minimal stub so FaviconThemeSync
// doesn't throw when the normal app renders (isBlockedTab = false path).
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
}

// Mock all lazy-loaded pages so Suspense doesn't need to resolve them
vi.mock('./pages/Home', () => ({ default: () => <div>Home</div> }));
vi.mock('./pages/Invite', () => ({ default: () => <div>Invite</div> }));
vi.mock('./pages/LinkDevice.jsx', () => ({ default: () => <div>LinkDevice</div> }));
vi.mock('./pages/Room', () => ({ default: () => <div>Room</div> }));
vi.mock('./pages/Roadmap', () => ({ default: () => <div>Roadmap</div> }));
vi.mock('./pages/ServerLayout', () => ({ default: () => <div>ServerLayout</div> }));
vi.mock('./pages/ExplorePage', () => ({ default: () => <div>ExplorePage</div> }));

import App from './App';
import { useSingleTab } from './hooks/useSingleTab';
import { cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// BroadcastChannel mock infrastructure — used by useSingleTab unit tests
// ---------------------------------------------------------------------------

/**
 * A minimal BroadcastChannel mock that wires all instances sharing the same
 * channel name together so messages actually propagate between them.
 */
class MockBroadcastChannel {
  constructor(name) {
    this.name = name;
    this.onmessage = null;
    this.closed = false;
    MockBroadcastChannel._instances.push(this);
  }

  postMessage(data) {
    if (this.closed) return;
    for (const other of MockBroadcastChannel._instances) {
      if (other !== this && other.name === this.name && !other.closed && other.onmessage) {
        other.onmessage({ data });
      }
    }
  }

  close() {
    this.closed = true;
  }

  static _instances = [];

  static reset() {
    MockBroadcastChannel._instances = [];
  }
}

// ---------------------------------------------------------------------------
// useSingleTab hook unit tests (import the real hook directly)
// ---------------------------------------------------------------------------

// Import the real hook for unit-level tests in a sub-describe block.
// The vi.mock('./hooks/useSingleTab') above affects App, but we can
// still import and test the real hook by importing it directly below.
// Note: vi.mock hoisting replaces the module in all describe blocks that
// import via './hooks/useSingleTab'. To test the actual hook implementation
// we must bypass the mock using importActual.
const { useSingleTab: realUseSingleTab } = await vi.importActual('./hooks/useSingleTab');

let originalBroadcastChannel;

describe('useSingleTab', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockBroadcastChannel.reset();
    originalBroadcastChannel = global.BroadcastChannel;
    global.BroadcastChannel = MockBroadcastChannel;
  });

  afterEach(() => {
    vi.useRealTimers();
    global.BroadcastChannel = originalBroadcastChannel;
  });

  it('isBlockedTab is true when session_active is received within 500ms (duplicate tab)', async () => {
    const { result } = renderHook(() => realUseSingleTab());

    await act(async () => {
      const hookChannel = MockBroadcastChannel._instances[0];
      if (hookChannel?.onmessage) {
        hookChannel.onmessage({ data: { type: 'session_active' } });
      }
    });

    expect(result.current.isBlockedTab).toBe(true);
  });

  it('isBlockedTab is false when no session_active received within 500ms (primary tab)', async () => {
    const { result } = renderHook(() => realUseSingleTab());

    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(result.current.isBlockedTab).toBe(false);
  });

  it('isBlockedTab becomes true when session_takeover is received (old tab yields)', async () => {
    const { result } = renderHook(() => realUseSingleTab());

    // Advance past ping timeout so it becomes the primary tab
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current.isBlockedTab).toBe(false);

    // New tab sends session_takeover
    await act(async () => {
      const hookChannel = MockBroadcastChannel._instances[0];
      if (hookChannel?.onmessage) {
        hookChannel.onmessage({ data: { type: 'session_takeover' } });
      }
    });

    expect(result.current.isBlockedTab).toBe(true);
  });

  it('isBlockedTab is false when BroadcastChannel is unavailable (graceful degradation)', async () => {
    global.BroadcastChannel = function () {
      throw new Error('BroadcastChannel is not supported');
    };

    const { result } = renderHook(() => realUseSingleTab());

    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(result.current.isBlockedTab).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// App integration: blocked-tab overlay rendering
// ---------------------------------------------------------------------------

describe('App — blocked-tab overlay', () => {
  beforeEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the blocked-tab overlay when isBlockedTab is true', () => {
    useSingleTab.mockReturnValue({ isBlockedTab: true, takeOver: vi.fn() });

    render(<MemoryRouter><App /></MemoryRouter>);

    expect(screen.getByText(/already open in another tab/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /use this one instead/i })).toBeInTheDocument();
  });

  it('renders the normal app when isBlockedTab is false', () => {
    useSingleTab.mockReturnValue({ isBlockedTab: false, takeOver: vi.fn() });

    render(<MemoryRouter><App /></MemoryRouter>);

    expect(screen.queryByText(/already open in another tab/i)).not.toBeInTheDocument();
  });

  it('renders the public device-link route while logged out', async () => {
    useSingleTab.mockReturnValue({ isBlockedTab: false, takeOver: vi.fn() });

    render(<MemoryRouter initialEntries={['/link-device?mode=new']}><App /></MemoryRouter>);

    expect(screen.queryByText(/already open in another tab/i)).not.toBeInTheDocument();
    expect(await screen.findByText('LinkDevice')).toBeInTheDocument();
  });

  it('calls takeOver when "Use this one instead" button is clicked', async () => {
    const takeOver = vi.fn();
    useSingleTab.mockReturnValue({ isBlockedTab: true, takeOver });

    render(<MemoryRouter><App /></MemoryRouter>);

    const buttons = screen.getAllByRole('button', { name: /use this one instead/i });
    await userEvent.click(buttons[0]);

    expect(takeOver).toHaveBeenCalledTimes(1);
  });
});
