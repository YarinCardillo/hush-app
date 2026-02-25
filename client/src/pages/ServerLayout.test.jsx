import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ServerLayout from './ServerLayout';

vi.mock('../lib/api', () => ({
  getServer: vi.fn(),
  listServers: vi.fn().mockResolvedValue([]),
  createServer: vi.fn(),
  joinServer: vi.fn(),
  getInviteByCode: vi.fn(),
  createChannel: vi.fn(),
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

  it('shows channel name when channelId matches', async () => {
    vi.mocked(getServer).mockResolvedValue({
      server: { id: 's1', name: 'Test' },
      channels: [{ id: 'ch1', serverId: 's1', name: 'general', type: 'text', position: 0, parentId: null }],
      myRole: 'member',
    });
    renderWithRoute('/server/s1/channel/ch1');
    await waitFor(() => {
      expect(screen.getByText('#general')).toBeInTheDocument();
    });
    expect(screen.getByText('Text channel')).toBeInTheDocument();
  });

  it('does not fetch when no token', () => {
    sessionStorage.removeItem('hush_jwt');
    sessionStorage.removeItem('hush_token');
    renderWithRoute('/server/s1');
    expect(getServer).not.toHaveBeenCalled();
  });
});
