/**
 * Tests for Chat.jsx — byte-based message length enforcement (LNCH-05).
 *
 * Focuses on the MAX_PLAINTEXT_BYTES constant (4000 bytes) which enforces
 * the effective plaintext limit before MLS encryption. The server limit is
 * 8 KiB ciphertext; the client conservatively limits to 4000 plaintext bytes
 * to account for UTF-8 multi-byte chars and MLS framing overhead.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import Chat from './Chat.jsx';

// Minimal mock for useMLS — we only test UI behavior, not crypto.
vi.mock('../hooks/useMLS', () => ({
  useMLS: () => ({
    encryptForChannel: vi.fn().mockResolvedValue({ ciphertext: new Uint8Array(32) }),
    decryptFromChannel: vi.fn().mockResolvedValue('decrypted text'),
    getCachedMessage: vi.fn().mockResolvedValue(null),
    setCachedMessage: vi.fn(),
  }),
}));

vi.mock('../lib/api', () => ({
  getChannelMessages: vi.fn().mockResolvedValue([]),
}));

const defaultProps = {
  channelId: 'ch-1',
  serverId: 'srv-1',
  currentUserId: 'user-1',
  getToken: () => 'test-token',
  getStore: () => Promise.resolve(null),
  wsClient: {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    isConnected: () => true,
  },
  members: [],
};

describe('Chat byte limit enforcement (LNCH-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('send button is enabled for a short ASCII message', async () => {
    await act(async () => {
      render(<Chat {...defaultProps} />);
    });

    const input = screen.getByPlaceholderText('send a message...');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Hello world' } });
    });

    const sendBtn = screen.getByText('Send');
    expect(sendBtn).not.toBeDisabled();
  });

  it('send button is disabled when byte length exceeds MAX_PLAINTEXT_BYTES (4000)', async () => {
    await act(async () => {
      render(<Chat {...defaultProps} />);
    });

    const input = screen.getByPlaceholderText('send a message...');
    // Create a string that is exactly 4001 ASCII bytes (1 byte per char)
    const oversizedText = 'a'.repeat(4001);

    await act(async () => {
      fireEvent.change(input, { target: { value: oversizedText } });
    });

    const sendBtn = screen.getByText('Send');
    expect(sendBtn).toBeDisabled();
  });

  it('send button is NOT disabled at exactly MAX_PLAINTEXT_BYTES (4000)', async () => {
    await act(async () => {
      render(<Chat {...defaultProps} />);
    });

    const input = screen.getByPlaceholderText('send a message...');
    // Exactly 4000 ASCII bytes — should be allowed
    const exactText = 'a'.repeat(4000);

    await act(async () => {
      fireEvent.change(input, { target: { value: exactText } });
    });

    const sendBtn = screen.getByText('Send');
    expect(sendBtn).not.toBeDisabled();
  });

  it('byte counter appears when message exceeds 80% of MAX_PLAINTEXT_BYTES', async () => {
    await act(async () => {
      render(<Chat {...defaultProps} />);
    });

    const input = screen.getByPlaceholderText('send a message...');
    // 3201 bytes > 80% of 4000 (3200 threshold)
    const nearLimitText = 'a'.repeat(3201);

    await act(async () => {
      fireEvent.change(input, { target: { value: nearLimitText } });
    });

    // Counter shows bytes remaining: 4000 - 3201 = 799
    const counter = screen.getByText('799');
    expect(counter).toBeInTheDocument();
  });

  it('byte counter is not shown for short messages (below 80% threshold)', async () => {
    await act(async () => {
      render(<Chat {...defaultProps} />);
    });

    const input = screen.getByPlaceholderText('send a message...');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'short message' } });
    });

    // No counter element should exist for short messages
    const counter = document.querySelector('.chat-byte-counter');
    expect(counter).not.toBeInTheDocument();
  });
});
