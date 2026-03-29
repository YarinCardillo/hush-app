import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAuthInstanceSelection } from './useAuthInstanceSelection.js';

const getActiveAuthInstanceUrlSync = vi.hoisted(() => vi.fn(() => 'https://app.gethush.live'));
const getInstanceDisplayName = vi.hoisted(() => vi.fn((value) => new URL(value).host));
const loadKnownAuthInstances = vi.hoisted(() => vi.fn());
const markAuthInstanceUsed = vi.hoisted(() => vi.fn());
const selectAuthInstance = vi.hoisted(() => vi.fn());

vi.mock('../lib/authInstanceStore', () => ({
  getActiveAuthInstanceUrlSync,
  getInstanceDisplayName,
  loadKnownAuthInstances,
  markAuthInstanceUsed,
  selectAuthInstance,
}));

describe('useAuthInstanceSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getActiveAuthInstanceUrlSync.mockReturnValue('https://app.gethush.live');
    getInstanceDisplayName.mockImplementation((value) => new URL(value).host);
    loadKnownAuthInstances.mockResolvedValue([
      { url: 'https://app.gethush.live', lastUsedAt: 0 },
      { url: 'https://chat.example.com', lastUsedAt: 10 },
    ]);
    selectAuthInstance.mockResolvedValue('https://chat.example.com');
    markAuthInstanceUsed.mockResolvedValue('https://chat.example.com');
  });

  it('loads known instances and updates the selected instance when choosing and remembering one', async () => {
    const { result } = renderHook(() => useAuthInstanceSelection());

    await waitFor(() => {
      expect(result.current.knownInstances).toHaveLength(2);
    });

    expect(result.current.selectedInstanceUrl).toBe('https://app.gethush.live');
    expect(result.current.selectedInstanceLabel).toBe('app.gethush.live');

    await act(async () => {
      await result.current.chooseInstance('chat.example.com');
    });

    expect(selectAuthInstance).toHaveBeenCalledWith('chat.example.com');
    expect(result.current.selectedInstanceUrl).toBe('https://chat.example.com');

    await act(async () => {
      await result.current.rememberSelectedInstance();
    });

    expect(markAuthInstanceUsed).toHaveBeenCalledWith('https://chat.example.com');
    expect(loadKnownAuthInstances).toHaveBeenCalledTimes(3);
  });
});
