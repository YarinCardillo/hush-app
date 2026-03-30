import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ServerLayout from './ServerLayout';

const { mockVerifyOwnKey } = vi.hoisted(() => ({
  mockVerifyOwnKey: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('../lib/mlsStore', () => ({
  openStore: vi.fn().mockReturnValue(Promise.resolve({})),
  preloadGroupState: vi.fn().mockResolvedValue(undefined),
  flushStorageCache: vi.fn().mockResolvedValue(undefined),
  getCredential: vi.fn().mockResolvedValue({
    signingPublicKey: new Uint8Array(32),
    signingPrivateKey: new Uint8Array(64),
    credentialBytes: new Uint8Array(16),
  }),
  setCredential: vi.fn().mockResolvedValue(undefined),
  getGroupEpoch: vi.fn().mockResolvedValue(null),
  setGroupEpoch: vi.fn().mockResolvedValue(undefined),
  deleteGroupEpoch: vi.fn().mockResolvedValue(undefined),
  listAllGroupEpochs: vi.fn().mockResolvedValue([]),
  getKeyPackage: vi.fn().mockResolvedValue(null),
  setKeyPackage: vi.fn().mockResolvedValue(undefined),
  deleteKeyPackage: vi.fn().mockResolvedValue(undefined),
  listAllKeyPackages: vi.fn().mockResolvedValue([]),
  getLastResort: vi.fn().mockResolvedValue(null),
  setLastResort: vi.fn().mockResolvedValue(undefined),
  getLocalPlaintext: vi.fn().mockResolvedValue(null),
  setLocalPlaintext: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/mlsGroup', () => ({
  createChannelGroup: vi.fn().mockResolvedValue({ groupInfoBytes: new Uint8Array(0), epoch: 0 }),
  joinChannelGroup: vi.fn().mockResolvedValue(undefined),
  joinOrCreateChannelGroup: vi.fn().mockResolvedValue(undefined),
  joinAllChannelGroups: vi.fn().mockResolvedValue(undefined),
  joinGuildMetadataGroup: vi.fn().mockResolvedValue(undefined),
  leaveGuildMetadataGroup: vi.fn().mockResolvedValue(undefined),
  exportGuildMetadataKey: vi.fn().mockResolvedValue({ metadataKeyBytes: new Uint8Array(32) }),
  addMemberToChannel: vi.fn().mockResolvedValue({ welcomeBytes: new Uint8Array(0) }),
  removeMemberFromChannel: vi.fn().mockResolvedValue(undefined),
  encryptMessage: vi.fn().mockResolvedValue({ messageBytes: new Uint8Array(0), localId: 'test' }),
  decryptMessage: vi.fn().mockResolvedValue({ plaintext: 'test', senderIdentity: null }),
  processCommit: vi.fn().mockResolvedValue(undefined),
  catchupCommits: vi.fn().mockResolvedValue(undefined),
  leaveChannelGroup: vi.fn().mockResolvedValue(undefined),
  leaveAllChannelGroups: vi.fn().mockResolvedValue(undefined),
  performSelfUpdate: vi.fn().mockResolvedValue(undefined),
  createGuildMetadataGroup: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/hushCrypto', () => ({
  init: vi.fn().mockResolvedValue(undefined),
  generateCredential: vi.fn().mockResolvedValue({
    signingPublicKey: new Uint8Array(32),
    signingPrivateKey: new Uint8Array(64),
    credentialBytes: new Uint8Array(16),
  }),
  generateKeyPackage: vi.fn().mockResolvedValue({
    keyPackageBytes: new Uint8Array(0),
    privateKeyBytes: new Uint8Array(0),
    hashRefBytes: new Uint8Array(0),
  }),
  createGroup: vi.fn().mockResolvedValue({ groupInfoBytes: new Uint8Array(0), epoch: 0 }),
  joinGroupExternal: vi.fn().mockResolvedValue({ commitBytes: new Uint8Array(0), epoch: 0 }),
  addMembers: vi.fn().mockResolvedValue({ commitBytes: new Uint8Array(0), welcomeBytes: new Uint8Array(0), groupInfoBytes: new Uint8Array(0), epoch: 0 }),
  createMessage: vi.fn().mockResolvedValue({ messageBytes: new Uint8Array(0) }),
  processMessage: vi.fn().mockResolvedValue({ type: 'application', plaintext: new Uint8Array(0), epoch: 0 }),
  removeMembers: vi.fn().mockResolvedValue({ commitBytes: new Uint8Array(0), groupInfoBytes: new Uint8Array(0), epoch: 0 }),
  selfUpdate: vi.fn().mockResolvedValue({ commitBytes: new Uint8Array(0), groupInfoBytes: new Uint8Array(0), epoch: 0 }),
  leaveGroup: vi.fn().mockResolvedValue({ proposalBytes: new Uint8Array(0) }),
  mergePendingCommit: vi.fn().mockResolvedValue({ groupInfoBytes: new Uint8Array(0), epoch: 0 }),
  exportGroupInfoBytes: vi.fn().mockResolvedValue({ groupInfoBytes: new Uint8Array(0) }),
}));

vi.mock('../hooks/useKeyPackageMaintenance', () => ({
  useKeyPackageMaintenance: vi.fn(),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    token: 'test-token',
    user: { id: 'u1' },
    logout: vi.fn(),
  })),
  AuthProvider: ({ children }) => children,
}));

vi.mock('../contexts/InstanceContext', () => ({
  useInstanceContext: vi.fn(() => ({
    instanceStates: new Map(),
    mergedGuilds: [{ id: 's1', name: 'Test Guild', ownerId: 'u1' }],
    getWsClient: vi.fn(() => null),
    getTokenForInstance: vi.fn(() => null),
    refreshGuilds: vi.fn().mockResolvedValue(undefined),
    bootInstance: vi.fn().mockResolvedValue(undefined),
    disconnectInstance: vi.fn().mockResolvedValue(undefined),
    guildOrder: [],
    setGuildOrder: vi.fn().mockResolvedValue(undefined),
  })),
  InstanceProvider: ({ children }) => children,
}));

vi.mock('../hooks/useAuth', () => ({
  JWT_KEY: 'hush_jwt',
  HOME_INSTANCE_KEY: 'hush_home_instance',
  getDeviceId: vi.fn(() => 'device-1'),
}));

vi.mock('../lib/api', () => ({
  getInstance: vi.fn().mockResolvedValue({ name: 'Test Instance', serverCreationPolicy: 'open' }),
  getMyGuilds: vi.fn().mockResolvedValue([
    { id: 's1', name: 'Test Guild', ownerId: 'u1' },
  ]),
  getGuildChannels: vi.fn().mockResolvedValue([]),
  getGuildMembers: vi.fn().mockResolvedValue([
    { id: 'u1', displayName: 'User One', role: 'member' },
  ]),
  // Key maintenance deps — no-ops in test context
  uploadMLSKeyPackages: vi.fn().mockResolvedValue(undefined),
  getKeyPackageCount: vi.fn().mockResolvedValue(100),
  getHandshake: vi.fn().mockResolvedValue({ key_package_low_threshold: 10 }),
}));

vi.mock('../hooks/useBreakpoint', () => ({
  useBreakpoint: vi.fn(() => 'desktop'),
}));

vi.mock('../hooks/useSidebarResize', () => ({
  useSidebarResize: vi.fn(() => ({ width: 240, handleMouseDown: vi.fn() })),
}));

vi.mock('../lib/ws', () => ({
  createWsClient: vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  })),
}));

vi.mock('../lib/transparencyVerifier', () => ({
  TransparencyVerifier: vi.fn().mockImplementation(() => ({
    verifyOwnKey: mockVerifyOwnKey,
  })),
}));

// ServerList imports UserSettingsModal which calls window.matchMedia at module load time
vi.mock('../components/ServerList', () => ({
  default: function MockServerList() {
    return <div data-testid="server-list" />;
  },
}));

vi.mock('../components/GuildCreateModal', () => ({
  default: function MockGuildCreateModal({ onClose, onCreated }) {
    return (
      <div data-testid="guild-create-modal">
        <button type="button" onClick={() => onCreated({ id: 'g-new', instanceUrl: 'https://a.example.com' })}>
          Create
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    );
  },
}));

// ChannelList also imports ServerSettingsModal — mock the whole component
vi.mock('../components/ChannelList', () => ({
  default: function MockChannelList() {
    return <div data-testid="channel-list" />;
  },
}));

// MemberList
vi.mock('../components/MemberList', () => ({
  default: function MockMemberList() {
    return <div data-testid="member-list" />;
  },
}));

vi.mock('../components/UserPanel', () => ({
  default: function MockUserPanel() {
    return <div data-testid="user-panel" />;
  },
}));

vi.mock('./TextChannel', () => ({
  default: function MockTextChannel({ channel, sidebarSlot }) {
    return (
      <div data-testid="text-channel">
        <span>#{channel?.name}</span>
        {sidebarSlot}
      </div>
    );
  },
}));

vi.mock('./VoiceChannel', () => ({
  default: function MockVoiceChannel({ channel }) {
    return (
      <div data-testid="voice-channel">
        <span>#{channel?.name}</span>
        <span>Live</span>
      </div>
    );
  },
}));

// Stable mock: show must be the same reference across renders to avoid
// triggering effects that list showToast as a dependency on every re-render.
// vi.hoisted() runs before vi.mock() hoisting so the reference is available.
const { mockShow } = vi.hoisted(() => ({ mockShow: vi.fn() }));
vi.mock('../hooks/useToast', () => ({
  useToast: vi.fn(() => ({ toasts: [], show: mockShow })),
}));

import { getGuildChannels, getGuildMembers } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useInstanceContext } from '../contexts/InstanceContext';
import { TransparencyVerifier } from '../lib/transparencyVerifier';

function renderAtRoute(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/home" element={<ServerLayout />} />
        <Route path="/guilds" element={<ServerLayout />} />
        <Route path="/servers/:serverId/*" element={<ServerLayout />} />
        <Route path="/:instance/:guildSlug/:channelSlug?" element={<ServerLayout />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ServerLayout', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    sessionStorage.setItem('hush_jwt', 'test-token');
    vi.mocked(getGuildChannels).mockResolvedValue([]);
    vi.mocked(getGuildMembers).mockResolvedValue([]);
    mockVerifyOwnKey.mockClear();
    vi.mocked(TransparencyVerifier).mockClear();
  });

  it('shows welcome message when no guild is selected (/guilds route)', async () => {
    renderAtRoute('/guilds');
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('opens the guild creation modal from the welcome empty-state when the instance policy is open', async () => {
    vi.mocked(useInstanceContext).mockReturnValueOnce({
      instanceStates: new Map([
        ['https://a.example.com', {
          connectionState: 'connected',
          handshakeData: { server_creation_policy: 'open' },
        }],
      ]),
      mergedGuilds: [],
      getWsClient: vi.fn(() => null),
      getTokenForInstance: vi.fn(() => null),
      refreshGuilds: vi.fn().mockResolvedValue(undefined),
      bootInstance: vi.fn().mockResolvedValue(undefined),
      disconnectInstance: vi.fn().mockResolvedValue(undefined),
      guildOrder: [],
      setGuildOrder: vi.fn().mockResolvedValue(undefined),
    });

    renderAtRoute('/guilds');

    const createButton = await screen.findByRole('button', { name: /create a server/i });
    fireEvent.click(createButton);

    expect(screen.getByTestId('guild-create-modal')).toBeInTheDocument();
  });

  it('shows "select a channel" orb when serverId is set but no channelId', async () => {
    renderAtRoute('/servers/s1/channels');
    await waitFor(() => {
      expect(screen.getByText(/select(?: a)? channel/i)).toBeInTheDocument();
    });
  });

  it('locks overflow on the main authenticated layout', async () => {
    const { container } = renderAtRoute('/servers/s1/channels');

    await waitFor(() => {
      expect(screen.getByText(/select(?: a)? channel/i)).toBeInTheDocument();
    });

    expect(container.querySelector('.lay-container')).toHaveStyle({ overflow: 'hidden' });
    expect(document.body.dataset.hushScrollMode).toBe('locked');
    expect(document.body.style.overflowY).toBe('hidden');
  });

  it('fetches channels and members when serverId is in the URL', async () => {
    renderAtRoute('/servers/s1/channels');
    await waitFor(() => {
      // instanceUrl is null for legacy routes (no instanceUrl on mergedGuilds mock guild).
      expect(getGuildChannels).toHaveBeenCalledWith('test-token', 's1', undefined);
      expect(getGuildMembers).toHaveBeenCalledWith('test-token', 's1', undefined);
    });
  });

  it('renders TextChannel when a text channel is active', async () => {
    vi.mocked(getGuildChannels).mockResolvedValue([
      { id: 'ch1', name: 'general', type: 'text', position: 0, parentId: null },
    ]);
    renderAtRoute('/servers/s1/channels/ch1');
    await waitFor(() => {
      expect(screen.getByTestId('text-channel')).toBeInTheDocument();
    });
    expect(screen.getByTestId('text-channel')).toHaveTextContent('general');
  });

  it('locks overflow while viewing a voice channel', async () => {
    vi.mocked(getGuildChannels).mockResolvedValue([
      { id: 'ch2', name: 'standup', type: 'voice', position: 0, parentId: null },
    ]);

    const { container } = renderAtRoute('/servers/s1/channels/ch2');

    await waitFor(() => {
      expect(screen.getByTestId('voice-channel')).toBeInTheDocument();
    });

    expect(container.querySelector('.lay-container')).toHaveStyle({ overflow: 'hidden' });
  });

  it('does not fetch guild data when no auth token in context', () => {
    vi.mocked(useAuth).mockReturnValueOnce({ token: null, user: null, logout: vi.fn() });
    sessionStorage.removeItem('hush_jwt');
    sessionStorage.removeItem('hush_token');
    vi.mocked(getGuildChannels).mockClear();
    vi.mocked(getGuildMembers).mockClear();
    renderAtRoute('/servers/s1/channels');
    expect(getGuildChannels).not.toHaveBeenCalled();
  });

  it('skips own-key transparency verification on remote guild instances', async () => {
    localStorage.setItem('hush_home_instance', 'https://home.example.com');
    vi.mocked(useInstanceContext).mockReturnValueOnce({
      instanceStates: new Map([
        ['https://remote.example.com', { connectionState: 'connected' }],
      ]),
      mergedGuilds: [{
        id: 's-remote',
        name: 'Test Guild',
        ownerId: 'u1',
        instanceUrl: 'https://remote.example.com',
      }],
      getWsClient: vi.fn(() => null),
      getTokenForInstance: vi.fn(() => 'remote-token'),
      refreshGuilds: vi.fn().mockResolvedValue(undefined),
      bootInstance: vi.fn().mockResolvedValue(undefined),
      disconnectInstance: vi.fn().mockResolvedValue(undefined),
      guildOrder: [],
      setGuildOrder: vi.fn().mockResolvedValue(undefined),
    });

    vi.mocked(useAuth).mockReturnValueOnce({
      token: 'home-token',
      user: { id: 'u1' },
      logout: vi.fn(),
      identityKeyRef: { current: { publicKey: new Uint8Array(32) } },
      transparencyError: null,
      setTransparencyError: vi.fn(),
    });

    const { getHandshake } = await import('../lib/api');
    vi.mocked(getHandshake).mockResolvedValue({
      transparency_url: '/api/transparency',
      log_public_key: 'aa'.repeat(32),
      key_package_low_threshold: 10,
    });

    renderAtRoute('/remote.example.com/test-guild');

    await waitFor(() => {
      expect(getGuildChannels).toHaveBeenCalledWith('remote-token', 's-remote', 'https://remote.example.com');
    });

    expect(TransparencyVerifier).not.toHaveBeenCalled();
    expect(mockVerifyOwnKey).not.toHaveBeenCalled();
  });
});
