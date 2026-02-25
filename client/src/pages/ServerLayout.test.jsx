import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ServerLayout from './ServerLayout';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ token: 'test-token', user: { id: 'u1' } })),
}));
vi.mock('../hooks/useAuth', () => ({
  JWT_KEY: 'hush_jwt',
}));

vi.mock('../lib/api', () => ({
  getServer: vi.fn(),
  getServerMembers: vi.fn().mockResolvedValue([
    { userId: 'u1', displayName: 'User One', role: 'member', joinedAt: '2025-01-01T00:00:00Z' },
  ]),
  listServers: vi.fn().mockResolvedValue([]),
  createServer: vi.fn(),
  joinServer: vi.fn(),
  getInviteByCode: vi.fn(),
  createChannel: vi.fn(),
}));

vi.mock('../hooks/useBreakpoint', () => ({
  useBreakpoint: vi.fn(() => 'desktop'),
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

vi.mock('./TextChannel', () => ({
  default: function MockTextChannel({ channel }) {
    return (
      <div data-testid="text-channel">
        <span>#{channel?.name}</span>
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

import { getServer } from '../lib/api';

function renderWithRoute(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/server" element={<ServerLayout />} />
        <Route path="/server/:serverId" element={<ServerLayout />} />
        <Route path="/server/:serverId/channel/:channelId" element={<ServerLayout />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ServerLayout', () => {
  beforeEach(() => {
    cleanup();
    vi.mocked(getServer).mockReset();
    sessionStorage.setItem('hush_jwt', 'test-token');
  });

  it('shows "Select a server" when no serverId in URL', () => {
    renderWithRoute('/server');
    expect(screen.getByText('Select a server')).toBeInTheDocument();
  });

  it('shows "Select a channel" when serverId but no channelId', async () => {
    vi.mocked(getServer).mockResolvedValue({
      server: { id: 's1', name: 'Test' },
      channels: [],
      myRole: 'admin',
    });
    renderWithRoute('/server/s1');
    await waitFor(() => {
      expect(screen.getByText('Select a channel')).toBeInTheDocument();
    });
  });

  it('renders TextChannel when channel is text type', async () => {
    vi.mocked(getServer).mockResolvedValue({
      server: { id: 's1', name: 'Test' },
      channels: [{ id: 'ch1', serverId: 's1', name: 'general', type: 'text', position: 0, parentId: null }],
      myRole: 'member',
      memberIds: ['u1'],
    });
    renderWithRoute('/server/s1/channel/ch1');
    await waitFor(() => {
      expect(screen.getByTestId('text-channel')).toBeInTheDocument();
    });
    const textChannel = screen.getByTestId('text-channel');
    expect(textChannel).toHaveTextContent('general');
    await waitFor(() => {
      expect(screen.getByText('MEMBERS — 1')).toBeInTheDocument();
    });
    expect(screen.getByText(/User One/)).toBeInTheDocument();
  });

  it('renders VoiceChannel when channel is voice type', async () => {
    vi.mocked(getServer).mockResolvedValue({
      server: { id: 's1', name: 'Test' },
      channels: [
        {
          id: 'ch-voice',
          serverId: 's1',
          name: 'Voice Room',
          type: 'voice',
          voiceMode: 'quality',
          position: 0,
          parentId: null,
        },
      ],
      myRole: 'member',
    });
    renderWithRoute('/server/s1/channel/ch-voice');
    await waitFor(() => {
      expect(screen.getByTestId('voice-channel')).toBeInTheDocument();
    });
    expect(screen.getByText('#Voice Room')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('does not fetch when no token', () => {
    sessionStorage.removeItem('hush_jwt');
    sessionStorage.removeItem('hush_token');
    renderWithRoute('/server/s1');
    expect(getServer).not.toHaveBeenCalled();
  });
});
