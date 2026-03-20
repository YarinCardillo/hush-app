import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import TextChannel from './TextChannel';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));
vi.mock('../lib/mlsStore', () => ({
  openStore: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('../components/Chat', () => ({
  // MLS: Chat no longer accepts recipientUserIds — single-ciphertext group encryption.
  default: function MockChat({ channelId }) {
    return (
      <div data-testid="chat-panel">
        <span data-testid="chat-channel-id">{channelId}</span>
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
      />,
    );
    expect(screen.getByText('#general')).toBeInTheDocument();
  });

  it('passes channelId to Chat', () => {
    const channel = { id: 'ch1', name: 'general', serverId: 's1' };
    const { container } = render(
      <TextChannel
        channel={channel}
        serverId="s1"
        getToken={() => 'token'}
        wsClient={{}}
      />,
    );
    const main = container.querySelector('[style*="flex: 1"]');
    expect(main).toBeInTheDocument();
    const chat = main?.querySelector('[data-testid="chat-panel"]');
    expect(chat).toBeInTheDocument();
    expect(within(chat).getByTestId('chat-channel-id')).toHaveTextContent('ch1');
  });
});
