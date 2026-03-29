import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../lib/api', () => ({
  getInviteInfo: vi.fn(),
  claimInvite: vi.fn(),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../contexts/InstanceContext', () => ({
  useInstanceContext: vi.fn(),
}));

vi.mock('../lib/guildMetadata', () => ({
  decodeGuildNameFromInvite: vi.fn((encoded) => decodeURIComponent(encoded)),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import * as apiModule from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useInstanceContext } from '../contexts/InstanceContext';
import Invite from './Invite';

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderInvite(path, routes = []) {
  const allRoutes = [
    <Route key="invite" path="/invite/:code" element={<Invite />} />,
    <Route key="join" path="/join/:instance/:code" element={<Invite />} />,
    <Route key="server" path="/servers/:serverId/channels" element={<div>Server channel</div>} />,
    ...routes,
  ];
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>{allRoutes}</Routes>
    </MemoryRouter>,
  );
}

function makeInstanceContext(overrides = {}) {
  return {
    bootInstance: vi.fn().mockResolvedValue(undefined),
    getTokenForInstance: vi.fn((instanceUrl) => {
      if (instanceUrl === window.location.origin) return 'local-jwt';
      return 'instance-jwt';
    }),
    instanceStates: new Map([
      ['https://remote.example.com', { connectionState: 'connected', jwt: 'instance-jwt' }],
      [window.location.origin, { connectionState: 'connected', jwt: 'local-jwt' }],
    ]),
    mergedGuilds: [],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Invite — same-instance flow', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.location.hash = '';
    sessionStorage.clear();
  });

  afterEach(() => {
    window.location.hash = '';
  });

  it('fetches invite info and shows guild preview for authenticated user', async () => {
    useAuth.mockReturnValue({ isAuthenticated: true });
    useInstanceContext.mockReturnValue(makeInstanceContext({
      instanceStates: new Map([
        ['https://local.example.com', { connectionState: 'connected', jwt: 'local-jwt' }],
      ]),
      mergedGuilds: [{ id: 'srv-1', instanceUrl: 'https://local.example.com', name: 'My Guild' }],
    }));
    apiModule.getInviteInfo.mockResolvedValue({ serverId: 'srv-1', memberCount: 42 });
    apiModule.claimInvite.mockResolvedValue({ serverId: 'srv-1' });

    renderInvite('/invite/abc123');

    // Initially shows loading
    expect(screen.getByText(/loading invite/i)).toBeInTheDocument();

    // After fetch: shows authenticated joining state
    await waitFor(() => {
      expect(screen.getByText(/you're invited to join/i)).toBeInTheDocument();
    });

    expect(apiModule.getInviteInfo).toHaveBeenCalledWith('abc123', undefined);
  });

  it('auto-claims invite for authenticated same-instance user', async () => {
    useAuth.mockReturnValue({ isAuthenticated: true });
    useInstanceContext.mockReturnValue(makeInstanceContext({
      instanceStates: new Map([
        [window.location.origin, { connectionState: 'connected', jwt: 'local-jwt' }],
      ]),
    }));
    apiModule.getInviteInfo.mockResolvedValue({ serverId: 'srv-1' });
    apiModule.claimInvite.mockResolvedValue({ serverId: 'srv-1' });

    renderInvite('/invite/abc123');

    await waitFor(() => {
      expect(apiModule.claimInvite).toHaveBeenCalledWith('local-jwt', 'abc123', window.location.origin);
    });
  });

  it('uses the current origin token instead of the first connected instance', async () => {
    useAuth.mockReturnValue({ isAuthenticated: true });
    const ctx = makeInstanceContext({
      instanceStates: new Map([
        ['https://remote.example.com', { connectionState: 'connected', jwt: 'wrong-first-jwt' }],
        [window.location.origin, { connectionState: 'connected', jwt: 'local-jwt' }],
      ]),
      getTokenForInstance: vi.fn((instanceUrl) => (
        instanceUrl === window.location.origin ? 'local-jwt' : 'wrong-first-jwt'
      )),
    });
    useInstanceContext.mockReturnValue(ctx);
    apiModule.getInviteInfo.mockResolvedValue({ serverId: 'srv-1' });
    apiModule.claimInvite.mockResolvedValue({ serverId: 'srv-1' });

    renderInvite('/invite/abc123');

    await waitFor(() => {
      expect(ctx.getTokenForInstance).toHaveBeenCalledWith(window.location.origin);
      expect(apiModule.claimInvite).toHaveBeenCalledWith('local-jwt', 'abc123', window.location.origin);
    });
  });

  it('shows error panel when invite code is invalid', async () => {
    useAuth.mockReturnValue({ isAuthenticated: false });
    useInstanceContext.mockReturnValue(makeInstanceContext({ instanceStates: new Map() }));
    apiModule.getInviteInfo.mockRejectedValue(new Error('not found'));

    renderInvite('/invite/bad-code');

    await waitFor(() => {
      expect(screen.getByText(/not found or expired/i)).toBeInTheDocument();
    });
  });

  it('shows error panel on network failure', async () => {
    useAuth.mockReturnValue({ isAuthenticated: false });
    useInstanceContext.mockReturnValue(makeInstanceContext({ instanceStates: new Map() }));
    apiModule.getInviteInfo.mockRejectedValue(new Error('fetch failed'));

    renderInvite('/invite/abc123');

    await waitFor(() => {
      // Any error message is rendered
      expect(screen.queryByText(/loading invite/i)).not.toBeInTheDocument();
    });
  });

  it('stores pending invite in sessionStorage for unauthenticated user', async () => {
    useAuth.mockReturnValue({ isAuthenticated: false });
    useInstanceContext.mockReturnValue(makeInstanceContext({ instanceStates: new Map() }));
    apiModule.getInviteInfo.mockResolvedValue({ serverId: 'srv-1' });

    renderInvite('/invite/abc123');

    await waitFor(() => {
      expect(sessionStorage.getItem('hush_pending_invite')).toBeTruthy();
    });
  });

  it('unauthenticated user sees Sign in to join button', async () => {
    useAuth.mockReturnValue({ isAuthenticated: false });
    useInstanceContext.mockReturnValue(makeInstanceContext({ instanceStates: new Map() }));
    apiModule.getInviteInfo.mockResolvedValue({ serverId: 'srv-1' });

    renderInvite('/invite/abc123');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in to join/i })).toBeInTheDocument();
    });
  });

  it('shows already-a-member error when claimInvite returns 409', async () => {
    useAuth.mockReturnValue({ isAuthenticated: true });
    useInstanceContext.mockReturnValue(makeInstanceContext({
      instanceStates: new Map([
        [window.location.origin, { connectionState: 'connected', jwt: 'local-jwt' }],
      ]),
      mergedGuilds: [],
    }));
    apiModule.getInviteInfo.mockResolvedValue({ serverId: 'srv-1' });
    apiModule.claimInvite.mockRejectedValue(Object.assign(new Error('already member 409'), {}));

    renderInvite('/invite/abc123');

    await waitFor(() => {
      expect(screen.getByText(/already a member/i)).toBeInTheDocument();
    });
  });
});

describe('Invite — cross-instance flow (/join/:instance/:code)', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.location.hash = '';
    sessionStorage.clear();
  });

  it('fetches invite info via the remote instance baseUrl', async () => {
    useAuth.mockReturnValue({ isAuthenticated: true });
    useInstanceContext.mockReturnValue(makeInstanceContext());
    apiModule.getInviteInfo.mockResolvedValue({ serverId: 'srv-x', memberCount: 7 });
    apiModule.claimInvite.mockResolvedValue({ serverId: 'srv-x' });

    renderInvite('/join/remote.example.com/xyz789');

    await waitFor(() => {
      expect(apiModule.getInviteInfo).toHaveBeenCalledWith('xyz789', 'https://remote.example.com');
    });
  });

  it('shows guild name and hosted-on line in confirm modal', async () => {
    useAuth.mockReturnValue({ isAuthenticated: true });
    useInstanceContext.mockReturnValue(makeInstanceContext());
    window.location.hash = '#name=Secret%20Guild';
    apiModule.getInviteInfo.mockResolvedValue({ serverId: 'srv-x', memberCount: 3 });

    renderInvite('/join/remote.example.com/xyz789');

    await waitFor(() => {
      expect(screen.getByText(/you're invited to join/i)).toBeInTheDocument();
      expect(screen.getByText(/remote\.example\.com/i)).toBeInTheDocument();
    });
  });

  it('shows member count in cross-instance confirm modal', async () => {
    useAuth.mockReturnValue({ isAuthenticated: true });
    useInstanceContext.mockReturnValue(makeInstanceContext());
    apiModule.getInviteInfo.mockResolvedValue({ memberCount: 5 });

    renderInvite('/join/remote.example.com/xyz789');

    await waitFor(() => {
      expect(screen.getByText(/5 members/i)).toBeInTheDocument();
    });
  });

  it('calls bootInstance then claimInvite on confirm click', async () => {
    const ctx = makeInstanceContext();
    useAuth.mockReturnValue({ isAuthenticated: true });
    useInstanceContext.mockReturnValue(ctx);
    apiModule.getInviteInfo.mockResolvedValue({ serverId: 'srv-x' });
    apiModule.claimInvite.mockResolvedValue({ serverId: 'srv-x' });

    renderInvite('/join/remote.example.com/xyz789');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^join$/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^join$/i }));

    await waitFor(() => {
      expect(ctx.bootInstance).toHaveBeenCalledWith('https://remote.example.com');
      expect(apiModule.claimInvite).toHaveBeenCalledWith(
        'instance-jwt',
        'xyz789',
        'https://remote.example.com',
      );
    });
  });

  it('shows connecting state during bootInstance', async () => {
    const ctx = makeInstanceContext({
      bootInstance: vi.fn(() => new Promise(() => {})), // never resolves
    });
    useAuth.mockReturnValue({ isAuthenticated: true });
    useInstanceContext.mockReturnValue(ctx);
    apiModule.getInviteInfo.mockResolvedValue({ serverId: 'srv-x' });

    renderInvite('/join/remote.example.com/xyz789');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^join$/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^join$/i }));

    await waitFor(() => {
      expect(screen.getByText(/connecting to instance/i)).toBeInTheDocument();
    });
  });

  it('stores pending invite in sessionStorage for unauthenticated cross-instance user', async () => {
    useAuth.mockReturnValue({ isAuthenticated: false });
    useInstanceContext.mockReturnValue(makeInstanceContext());
    apiModule.getInviteInfo.mockResolvedValue({ serverId: 'srv-x' });

    renderInvite('/join/remote.example.com/xyz789');

    await waitFor(() => {
      expect(sessionStorage.getItem('hush_pending_invite')).toBeTruthy();
    });
  });

  it('unauthenticated cross-instance user sees Sign in to join button', async () => {
    useAuth.mockReturnValue({ isAuthenticated: false });
    useInstanceContext.mockReturnValue(makeInstanceContext());
    apiModule.getInviteInfo.mockResolvedValue({ serverId: 'srv-x' });

    renderInvite('/join/remote.example.com/xyz789');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in to join/i })).toBeInTheDocument();
    });
  });
});
