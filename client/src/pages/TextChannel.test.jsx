import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import TextChannel from './TextChannel';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));
vi.mock('../lib/signalStore', () => ({
  openStore: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('../components/Chat', () => ({
  default: function MockChat({ channelId, getToken, getStore, wsClient, recipientUserIds }) {
    return (
      <div data-testid="chat-panel">
        <span data-testid="chat-channel-id">{channelId}</span>
        <span data-testid="chat-recipients">{recipientUserIds?.length ?? 0}</span>
      </div>
    );
  },
}));

import { useAuth } from '../contexts/AuthContext';

describe('TextChannel', () => {
  beforeEach(() => {
    cleanup();
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'user-1', displayName: 'Test User' },
    });
  });

  it('renders channel name in header', () => {
    const channel = { id: 'ch1', name: 'general', serverId: 's1' };
    render(
      <TextChannel
        channel={channel}
        serverId="s1"
        getToken={() => 'token'}
        wsClient={null}
        recipientUserIds={[]}
      />,
    );
    expect(screen.getByText('#general')).toBeInTheDocument();
  });

  it('passes correct props to Chat', () => {
    const channel = { id: 'ch1', name: 'general', serverId: 's1' };
    const recipientUserIds = ['user-2', 'user-3'];
    const { container } = render(
      <TextChannel
        channel={channel}
        serverId="s1"
        getToken={() => 'token'}
        wsClient={{}}
        recipientUserIds={recipientUserIds}
      />,
    );
    const main = container.querySelector('[style*="flex: 1"]');
    expect(main).toBeInTheDocument();
    const chat = main?.querySelector('[data-testid="chat-panel"]');
    expect(chat).toBeInTheDocument();
    expect(within(chat).getByTestId('chat-channel-id')).toHaveTextContent('ch1');
    expect(within(chat).getByTestId('chat-recipients')).toHaveTextContent('2');
  });

  it('defaults recipientUserIds to empty when not provided', () => {
    const channel = { id: 'ch1', name: 'general', serverId: 's1' };
    const { container } = render(
      <TextChannel channel={channel} serverId="s1" getToken={() => 'token'} wsClient={null} />,
    );
    const main = container.querySelector('[style*="flex: 1"]');
    const chat = main?.querySelector('[data-testid="chat-panel"]');
    expect(within(chat).getByTestId('chat-recipients')).toHaveTextContent('0');
  });
});
