import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import DeviceManagement from './DeviceManagement.jsx';

const { mockVerifyOwnKey, mockNavigate } = vi.hoisted(() => ({
  mockVerifyOwnKey: vi.fn().mockResolvedValue({ ok: true }),
  mockNavigate: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../lib/api.js', () => ({
  listDeviceKeys: vi.fn().mockResolvedValue([
    {
      deviceId: 'device-2',
      label: 'Laptop',
      lastSeen: '2026-03-30T12:00:00.000Z',
      certifiedAt: '2026-03-29T12:00:00.000Z',
    },
  ]),
  revokeDeviceKey: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/transparencyVerifier.js', () => ({
  TransparencyVerifier: vi.fn().mockImplementation(function MockTransparencyVerifier() {
    return {
      verifyOwnKey: mockVerifyOwnKey,
    };
  }),
}));

vi.mock('../hooks/useAuth.js', () => ({
  HOME_INSTANCE_KEY: 'hush_home_instance',
}));

import { listDeviceKeys, revokeDeviceKey } from '../lib/api.js';
import { TransparencyVerifier } from '../lib/transparencyVerifier.js';

describe('DeviceManagement', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('verifies transparency against the home instance after revoke', async () => {
    localStorage.setItem('hush_home_instance', 'https://home.example.com');

    render(
      <DeviceManagement
        token="home-token"
        currentDeviceId="device-1"
        identityKeyRef={{ current: { publicKey: new Uint8Array(32) } }}
        handshakeData={{
          transparency_url: '/api/transparency',
          log_public_key: 'aa'.repeat(32),
        }}
        setTransparencyError={vi.fn()}
      />,
    );

    expect(listDeviceKeys).toHaveBeenCalledWith('home-token');

    await screen.findByText('Laptop');
    fireEvent.click(screen.getByRole('button', { name: /^revoke$/i }));
    fireEvent.click(screen.getByRole('button', { name: /revoke device/i }));

    await waitFor(() => {
      expect(revokeDeviceKey).toHaveBeenCalledWith('home-token', 'device-2');
    });

    await waitFor(() => {
      expect(TransparencyVerifier).toHaveBeenCalledWith(
        'https://home.example.com',
        'aa'.repeat(32),
      );
    });

    expect(mockVerifyOwnKey).toHaveBeenCalled();
  });

  it('skips transparency verification when the log public key is absent', async () => {
    localStorage.setItem('hush_home_instance', 'https://home.example.com');

    render(
      <DeviceManagement
        token="home-token"
        currentDeviceId="device-1"
        identityKeyRef={{ current: { publicKey: new Uint8Array(32) } }}
        handshakeData={{ transparency_url: '/api/transparency' }}
        setTransparencyError={vi.fn()}
      />,
    );

    await screen.findByText('Laptop');
    fireEvent.click(screen.getByRole('button', { name: /^revoke$/i }));
    fireEvent.click(screen.getByRole('button', { name: /revoke device/i }));

    await waitFor(() => {
      expect(revokeDeviceKey).toHaveBeenCalledWith('home-token', 'device-2');
    });

    expect(TransparencyVerifier).not.toHaveBeenCalled();
    expect(mockVerifyOwnKey).not.toHaveBeenCalled();
  });
});
