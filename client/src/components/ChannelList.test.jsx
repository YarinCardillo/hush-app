import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import ChannelList from './ChannelList';

vi.mock('../lib/api', () => ({
  getServer: vi.fn(),
  createChannel: vi.fn(),
  createInvite: vi.fn(),
  moveChannel: vi.fn(),
  deleteChannel: vi.fn(),
}));

const getToken = () => 'test-token';

const textChannel = { id: 'c1', serverId: 's1', name: 'general', type: 'text', position: 0, parentId: null };
const voiceChannel = { id: 'c2', serverId: 's1', name: 'voice-1', type: 'voice', position: 1, parentId: null };
const channelInCategory = { id: 'c3', serverId: 's1', name: 'chat', type: 'text', position: 0, parentId: 'cat1' };
const categoryChannel = { id: 'cat1', serverId: 's1', name: 'Gaming', type: 'category', position: 0, parentId: null };

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

  it('groups channels by parentId without Uncategorized header', async () => {
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
    expect(screen.queryByText('Uncategorized')).not.toBeInTheDocument();
    expect(screen.getByText('Gaming')).toBeInTheDocument();
    expect(screen.getByText('general')).toBeInTheDocument();
    expect(screen.getByText('chat')).toBeInTheDocument();
  });

  it('does not show voice participant count when zero', () => {
    render(
      <ChannelList
        getToken={getToken}
        serverId="s1"
        serverName="My Server"
        channels={[voiceChannel]}
        myRole="member"
        activeChannelId={null}
        onChannelSelect={() => {}}
        voiceParticipantCounts={new Map([[voiceChannel.id, 0]])}
      />
    );
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('shows voice participant count when greater than zero', () => {
    render(
      <ChannelList
        getToken={getToken}
        serverId="s1"
        serverName="My Server"
        channels={[voiceChannel]}
        myRole="member"
        activeChannelId={null}
        onChannelSelect={() => {}}
        voiceParticipantCounts={new Map([[voiceChannel.id, 3]])}
      />
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('admin sees delete button on category header and can delete it', async () => {
    const { deleteChannel, getServer } = await import('../lib/api');
    deleteChannel.mockResolvedValueOnce({});
    getServer.mockResolvedValueOnce({ channels: [] });

    render(
      <ChannelList
        getToken={getToken}
        serverId="s1"
        serverName="My Server"
        channels={[categoryChannel]}
        myRole="admin"
        activeChannelId={null}
        onChannelSelect={() => {}}
        onChannelsUpdated={() => {}}
      />
    );
    const deleteBtn = screen.getByTitle('Delete category');
    deleteBtn.click();
    await waitFor(() => {
      expect(deleteChannel).toHaveBeenCalledWith('test-token', categoryChannel.id);
    });
  });

  it('admin sees a separate Create category button', () => {
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
    expect(screen.getByTitle('Create category')).toBeInTheDocument();
  });

  it('Create channel modal does not include Category as a type option', async () => {
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
    screen.getByTitle('Create channel').click();
    await waitFor(() => {
      expect(screen.getByLabelText('Type')).toBeInTheDocument();
    });
    const options = Array.from(screen.getByLabelText('Type').querySelectorAll('option')).map((o) => o.value);
    expect(options).not.toContain('category');
    expect(options).toContain('text');
    expect(options).toContain('voice');
  });

  it('Create category modal has only a name field and calls API with type:category', async () => {
    const { createChannel, getServer } = await import('../lib/api');
    createChannel.mockResolvedValueOnce({ id: 'cat-new', name: 'My Category', type: 'category', position: 0, serverId: 's1', parentId: null });
    getServer.mockResolvedValueOnce({ channels: [] });

    render(
      <ChannelList
        getToken={getToken}
        serverId="s1"
        serverName="My Server"
        channels={[]}
        myRole="admin"
        activeChannelId={null}
        onChannelSelect={() => {}}
        onChannelsUpdated={() => {}}
      />
    );
    screen.getByTitle('Create category').click();
    await waitFor(() => {
      expect(screen.getByLabelText('Name')).toBeInTheDocument();
    });
    expect(screen.queryByLabelText('Type')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My Category' } });
    screen.getByRole('button', { name: 'Create' }).click();

    await waitFor(() => {
      expect(createChannel).toHaveBeenCalledWith('test-token', 's1', { name: 'My Category', type: 'category' });
    });
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
