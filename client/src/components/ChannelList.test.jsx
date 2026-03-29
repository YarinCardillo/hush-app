import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import ChannelList from './ChannelList';

vi.mock('../lib/api', () => ({
  getGuildChannels: vi.fn(() => Promise.resolve([])),
  createGuildChannel: vi.fn(),
  createGuildInvite: vi.fn(),
  moveChannel: vi.fn(),
  deleteGuildChannel: vi.fn(),
}));

const getToken = () => 'test-token';

const textChannel = { id: 'c1', serverId: 's1', name: 'general', type: 'text', position: 0, parentId: null };
const voiceChannel = { id: 'c2', serverId: 's1', name: 'voice-1', type: 'voice', position: 1, parentId: null };
const channelInCategory = { id: 'c3', serverId: 's1', name: 'chat', type: 'text', position: 0, parentId: 'cat1' };
const categoryChannel = { id: 'cat1', serverId: 's1', name: 'Gaming', type: 'category', position: 0, parentId: null };

describe('ChannelList', () => {
  beforeEach(() => {
    cleanup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
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

  it('does not show voice participants when list is empty', () => {
    render(
      <ChannelList
        getToken={getToken}
        serverId="s1"
        serverName="My Server"
        channels={[voiceChannel]}
        myRole="member"
        activeChannelId={null}
        onChannelSelect={() => {}}
        voiceParticipants={new Map([[voiceChannel.id, []]])}
      />
    );
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('shows voice participant avatars when participants are present', () => {
    const participants = [
      { userId: 'u1', displayName: 'Alice' },
      { userId: 'u2', displayName: 'Bob' },
      { userId: 'u3', displayName: 'Charlie' },
    ];
    render(
      <ChannelList
        getToken={getToken}
        serverId="s1"
        serverName="My Server"
        channels={[voiceChannel]}
        myRole="member"
        activeChannelId={null}
        onChannelSelect={() => {}}
        voiceParticipants={new Map([[voiceChannel.id, participants]])}
      />
    );
    // Participants are shown as initials avatars with full name in title attribute
    expect(screen.getByTitle('Alice')).toBeInTheDocument();
    expect(screen.getByTitle('Bob')).toBeInTheDocument();
    expect(screen.getByTitle('Charlie')).toBeInTheDocument();
    // Initials are displayed inside the avatar elements
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('category header shows drag handle for admin', () => {
    render(
      <ChannelList
        getToken={getToken}
        serverId="s1"
        serverName="My Server"
        channels={[categoryChannel]}
        myRole="admin"
        activeChannelId={null}
        onChannelSelect={() => {}}
      />
    );
    expect(screen.getByTitle('Drag to reorder')).toBeInTheDocument();
  });

  it('category header does not show drag handle for non-admin', () => {
    render(
      <ChannelList
        getToken={getToken}
        serverId="s1"
        serverName="My Server"
        channels={[categoryChannel]}
        myRole="member"
        activeChannelId={null}
        onChannelSelect={() => {}}
      />
    );
    expect(screen.queryByTitle('Drag to reorder')).not.toBeInTheDocument();
  });

  it('admin sees delete button on category header and can delete it', async () => {
    const { deleteGuildChannel, getGuildChannels } = await import('../lib/api');
    deleteGuildChannel.mockResolvedValueOnce({});
    getGuildChannels.mockResolvedValueOnce([]);

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
    // Confirmation modal appears — click the "Delete" button to confirm.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    });
    screen.getByRole('button', { name: 'Delete' }).click();
    await waitFor(() => {
      expect(deleteGuildChannel).toHaveBeenCalledWith('test-token', 's1', categoryChannel.id);
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
    const { createGuildChannel, getGuildChannels } = await import('../lib/api');
    createGuildChannel.mockResolvedValueOnce({ id: 'cat-new', name: 'My Category', type: 'category', position: 0, serverId: 's1', parentId: null });
    getGuildChannels.mockResolvedValueOnce([]);

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
      expect(createGuildChannel).toHaveBeenCalledWith('test-token', 's1', { name: 'My Category', type: 'category' });
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

  it('builds and copies an instance-aware invite link from the invite modal', async () => {
    const { createGuildInvite } = await import('../lib/api');
    createGuildInvite.mockResolvedValueOnce({ code: 'abc123' });

    render(
      <ChannelList
        getToken={getToken}
        serverId="s1"
        guildName="My Server"
        instanceUrl="https://remote.example.com"
        channels={[textChannel]}
        myRole="admin"
        activeChannelId={null}
        onChannelSelect={() => {}}
      />
    );

    fireEvent.click(screen.getByTitle('Server menu'));
    fireEvent.click(screen.getByRole('button', { name: /invite people/i }));

    const expectedLink = `${window.location.origin}/join/remote.example.com/abc123#name=My%20Server`;

    await waitFor(() => {
      expect(createGuildInvite).toHaveBeenCalledWith('test-token', 's1', {}, 'https://remote.example.com');
      expect(screen.getByDisplayValue(expectedLink)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expectedLink);
    });
  });
});
