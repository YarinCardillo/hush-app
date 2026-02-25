import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import ChannelList from './ChannelList';

vi.mock('../lib/api', () => ({
  getServer: vi.fn(),
  createChannel: vi.fn(),
}));

const getToken = () => 'test-token';

const textChannel = { id: 'c1', serverId: 's1', name: 'general', type: 'text', position: 0, parentId: null };
const voiceChannel = { id: 'c2', serverId: 's1', name: 'voice-1', type: 'voice', position: 1, parentId: null };
const channelInCategory = { id: 'c3', serverId: 's1', name: 'chat', type: 'text', position: 0, parentId: 'cat1' };
const categoryChannel = { id: 'cat1', serverId: 's1', name: 'Gaming', type: 'text', position: 0, parentId: null };

describe('ChannelList', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders text and voice channels with correct icons', async () => {
    render(
      <ChannelList
        getToken={getToken}
        serverId="s1"
        serverName="My Server"
        channels={[textChannel, voiceChannel]}
        myRole="member"
        activeChannelId={null}
        onChannelSelect={() => {}}
      />
    );
    expect(screen.getByText('general')).toBeInTheDocument();
    expect(screen.getByText('voice-1')).toBeInTheDocument();
  });

  it('groups channels by parentId', async () => {
    render(
      <ChannelList
        getToken={getToken}
        serverId="s1"
        serverName="My Server"
        channels={[textChannel, channelInCategory, categoryChannel]}
        myRole="member"
        activeChannelId={null}
        onChannelSelect={() => {}}
      />
    );
    expect(screen.getByText('Uncategorized')).toBeInTheDocument();
    expect(screen.getByText('Gaming')).toBeInTheDocument();
    expect(screen.getByText('general')).toBeInTheDocument();
    expect(screen.getByText('chat')).toBeInTheDocument();
  });

  it('create channel modal shows voice mode only for voice type', async () => {
    render(
      <ChannelList
        getToken={getToken}
        serverId="s1"
        serverName="My Server"
        channels={[]}
        myRole="admin"
        activeChannelId={null}
        onChannelSelect={() => {}}
      />
    );
    const addBtn = screen.getByTitle('Create channel');
    addBtn.click();
    await waitFor(() => {
      expect(screen.getByText('Create channel')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Type')).toBeInTheDocument();
    expect(screen.queryByLabelText('Voice mode')).not.toBeInTheDocument();
    const typeSelect = screen.getByLabelText('Type');
    const options = typeSelect.querySelectorAll('option');
    const voiceOption = Array.from(options).find((o) => o.value === 'voice');
    expect(voiceOption).toBeTruthy();
    typeSelect.value = 'voice';
    typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => {
      expect(screen.getByLabelText('Voice mode')).toBeInTheDocument();
    });
  });
});
