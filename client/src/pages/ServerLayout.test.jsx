import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ServerLayout from './ServerLayout';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    token: 'test-token',
    user: { id: 'u1' },
    logout: vi.fn(),
  })),
  AuthProvider: ({ children }) => children,
}));

vi.mock('../hooks/useAuth', () => ({
  JWT_KEY: 'hush_jwt',
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
  uploadKeys: vi.fn().mockResolvedValue(undefined),
  getOPKCount: vi.fn().mockResolvedValue(100),
  getHandshake: vi.fn().mockResolvedValue({ opk_low_threshold: 10 }),
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

// ServerList imports UserSettingsModal which calls window.matchMedia at module load time
vi.mock('../components/ServerList', () => ({
  default: function MockServerList() {
    return <div data-testid="server-list" />;
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

vi.mock('../hooks/useToast', () => ({
  useToast: vi.fn(() => ({ toasts: [], show: vi.fn() })),
}));

import { getGuildChannels, getGuildMembers } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

function renderAtRoute(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/guilds" element={<ServerLayout />} />
        <Route path="/servers/:serverId/*" element={<ServerLayout />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ServerLayout', () => {
  beforeEach(() => {
    cleanup();
    sessionStorage.setItem('hush_jwt', 'test-token');
    vi.mocked(getGuildChannels).mockResolvedValue([]);
    vi.mocked(getGuildMembers).mockResolvedValue([]);
  });

  it('shows welcome message when no guild is selected (/guilds route)', async () => {
    renderAtRoute('/guilds');
    await waitFor(() => {
      expect(screen.getByText('Create a server or join one with an invite link.')).toBeInTheDocument();
    });
  });

  it('shows "select a channel" orb when serverId is set but no channelId', async () => {
    renderAtRoute('/servers/s1/channels');
    await waitFor(() => {
      expect(screen.getByText('select a channel')).toBeInTheDocument();
    });
  });

  it('fetches channels and members when serverId is in the URL', async () => {
    renderAtRoute('/servers/s1/channels');
    await waitFor(() => {
      expect(getGuildChannels).toHaveBeenCalledWith('test-token', 's1');
      expect(getGuildMembers).toHaveBeenCalledWith('test-token', 's1');
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

  it('does not fetch guild data when no auth token in context', () => {
    vi.mocked(useAuth).mockReturnValueOnce({ token: null, user: null, logout: vi.fn() });
    sessionStorage.removeItem('hush_jwt');
    sessionStorage.removeItem('hush_token');
    vi.mocked(getGuildChannels).mockClear();
    vi.mocked(getGuildMembers).mockClear();
    renderAtRoute('/servers/s1/channels');
    expect(getGuildChannels).not.toHaveBeenCalled();
  });
});
