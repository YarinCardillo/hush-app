import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, userEvent, waitFor, cleanup, fireEvent } from '@testing-library/react';
import ServerList from './ServerList';

vi.mock('../lib/api', () => ({
  listServers: vi.fn(),
  createServer: vi.fn(),
  joinServer: vi.fn(),
  getInviteByCode: vi.fn(),
}));

import { listServers, createServer } from '../lib/api';

const getToken = () => 'test-token';

describe('ServerList', () => {
  beforeEach(() => {
    cleanup();
    vi.mocked(listServers).mockResolvedValue([]);
    vi.mocked(createServer).mockClear();
  });

  it('renders servers from API', async () => {
    vi.mocked(listServers).mockResolvedValue([
      { id: 's1', name: 'Server One', role: 'admin' },
      { id: 's2', name: 'Server Two', role: 'member' },
    ]);
    render(<ServerList getToken={getToken} selectedServerId={null} onServerSelect={() => {}} />);
    await screen.findByTitle('Server One');
    expect(screen.getByTitle('Server One')).toBeInTheDocument();
    expect(screen.getByTitle('Server Two')).toBeInTheDocument();
  });

  it('shows empty state when list is empty', async () => {
    vi.mocked(listServers).mockResolvedValue([]);
    render(<ServerList getToken={getToken} selectedServerId={null} onServerSelect={() => {}} />);
    await screen.findByText('…');
    await waitFor(() => {
      expect(screen.queryByText('…')).not.toBeInTheDocument();
    });
    expect(screen.queryByTitle('Server One')).not.toBeInTheDocument();
  });

  it('create server modal validates input', async () => {
    vi.mocked(listServers).mockResolvedValue([]);
    render(<ServerList getToken={getToken} selectedServerId={null} onServerSelect={() => {}} />);
    await screen.findByTitle('Join server', {}, { timeout: 2000 });
    const createBtn = screen.queryByRole('button', { name: 'Create server' }) ?? screen.queryByTitle('Create server');
    expect(createBtn).toBeTruthy();
    fireEvent.click(createBtn);
    expect(screen.getByPlaceholderText('My server')).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Create' });
    fireEvent.click(submit);
    expect(createServer).not.toHaveBeenCalled();
    expect(screen.getByText('Name is required')).toBeInTheDocument();
  });
});
