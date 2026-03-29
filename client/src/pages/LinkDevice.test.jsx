import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import LinkDevice from './LinkDevice.jsx';

const {
  authState,
  mockQrToDataUrl,
  mockCreateDeviceLinkRequest,
  mockConsumeDeviceLinkResult,
  mockResolveDeviceLinkRequest,
  mockVerifyDeviceLinkRequest,
  mockCreateDeviceIdentity,
  mockCreateSessionKeyPair,
  mockBuildLinkApprovalUrl,
  mockChooseInstance,
  authInstanceSelectionState,
  mockOpenStore,
  mockExportHistorySnapshot,
  mockBytesToBase64,
  mockCertifyDevice,
  mockBase64ToBytes,
  mockEncodeTransferBundle,
  mockEncryptRelayPayload,
} = vi.hoisted(() => ({
  authState: { current: null },
  mockQrToDataUrl: vi.fn(),
  mockCreateDeviceLinkRequest: vi.fn(),
  mockConsumeDeviceLinkResult: vi.fn(),
  mockResolveDeviceLinkRequest: vi.fn(),
  mockVerifyDeviceLinkRequest: vi.fn(),
  mockCreateDeviceIdentity: vi.fn(),
  mockCreateSessionKeyPair: vi.fn(),
  mockBuildLinkApprovalUrl: vi.fn(),
  mockChooseInstance: vi.fn(),
  authInstanceSelectionState: { current: 'https://chat.example.com' },
  mockOpenStore: vi.fn(),
  mockExportHistorySnapshot: vi.fn(),
  mockBytesToBase64: vi.fn(),
  mockCertifyDevice: vi.fn(),
  mockBase64ToBytes: vi.fn(),
  mockEncodeTransferBundle: vi.fn(),
  mockEncryptRelayPayload: vi.fn(),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => authState.current,
}));

vi.mock('../hooks/useBodyScrollMode', () => ({
  BODY_SCROLL_MODE: { SCROLL: 'scroll' },
  useBodyScrollMode: vi.fn(),
}));

vi.mock('../hooks/useAuth', () => ({
  getDeviceId: () => 'device-1',
}));

vi.mock('../hooks/useAuthInstanceSelection.js', () => ({
  useAuthInstanceSelection: () => ({
    selectedInstanceUrl: authInstanceSelectionState.current,
    knownInstances: [{ url: authInstanceSelectionState.current, lastUsedAt: Date.now() }],
    chooseInstance: (...args) => mockChooseInstance(...args),
    rememberSelectedInstance: vi.fn(),
  }),
}));

vi.mock('../lib/api', () => ({
  consumeDeviceLinkResult: (...args) => mockConsumeDeviceLinkResult(...args),
  createDeviceLinkRequest: (...args) => mockCreateDeviceLinkRequest(...args),
  resolveDeviceLinkRequest: (...args) => mockResolveDeviceLinkRequest(...args),
  verifyDeviceLinkRequest: (...args) => mockVerifyDeviceLinkRequest(...args),
}));

vi.mock('../lib/mlsStore', () => ({
  openStore: (...args) => mockOpenStore(...args),
  exportHistorySnapshot: (...args) => mockExportHistorySnapshot(...args),
}));

vi.mock('../lib/deviceLinking', () => ({
  buildLinkApprovalUrl: (...args) => mockBuildLinkApprovalUrl(...args),
  bytesToBase64: (...args) => mockBytesToBase64(...args),
  certifyDevice: (...args) => mockCertifyDevice(...args),
  createDeviceIdentity: (...args) => mockCreateDeviceIdentity(...args),
  createSessionKeyPair: (...args) => mockCreateSessionKeyPair(...args),
  decodeQRPayload: vi.fn((encoded) => ({
    requestId: encoded === 'valid-payload' ? 'req-from-qr' : '',
    secret: encoded === 'valid-payload' ? 'secret-from-qr' : '',
    expiresAt: '2026-03-29T00:05:00.000Z',
  })),
  decodeTransferBundle: vi.fn(),
  decryptRelayPayload: vi.fn(),
  encodeTransferBundle: (...args) => mockEncodeTransferBundle(...args),
  encryptRelayPayload: (...args) => mockEncryptRelayPayload(...args),
  base64ToBytes: (...args) => mockBase64ToBytes(...args),
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: (...args) => mockQrToDataUrl(...args),
  },
}));

function renderLinkDevice(entry) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/link-device" element={<LinkDevice />} />
        <Route path="/" element={<div>Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LinkDevice', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    authState.current = {
      completeDeviceLink: vi.fn(),
      loading: false,
      isAuthenticated: false,
      vaultState: 'none',
      token: null,
      user: null,
      identityKeyRef: { current: null },
    };
    authInstanceSelectionState.current = 'https://chat.example.com';
    mockChooseInstance.mockImplementation(async (value) => {
      authInstanceSelectionState.current = value;
      return value;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a QR code and fallback code for a new-device request', async () => {
    mockCreateDeviceIdentity.mockResolvedValue({
      publicKeyBase64: 'device-public-key',
    });
    mockCreateSessionKeyPair.mockResolvedValue({
      privateKey: { type: 'private-key' },
      publicKeyBase64: 'session-public-key',
    });
    mockCreateDeviceLinkRequest.mockResolvedValue({
      requestId: 'req-1',
      secret: 'secret-1',
      code: 'ABCD1234',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
    mockBuildLinkApprovalUrl.mockReturnValue('https://app.gethush.live/link-device?payload=abc');
    mockQrToDataUrl.mockResolvedValue('data:image/png;base64,qr-code');
    mockConsumeDeviceLinkResult.mockResolvedValue({ status: 'pending' });

    renderLinkDevice('/link-device?mode=new');

    expect(await screen.findByAltText(/device link qr code/i)).toBeInTheDocument();
    expect(screen.getByText('ABCD1234')).toBeInTheDocument();
    expect(mockCreateDeviceLinkRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'device-1',
        devicePublicKey: 'device-public-key',
        sessionPublicKey: 'session-public-key',
        instanceUrl: 'https://chat.example.com',
      }),
      'https://chat.example.com',
    );
    await waitFor(() => {
      expect(mockConsumeDeviceLinkResult).toHaveBeenCalledWith({
        requestId: 'req-1',
        secret: 'secret-1',
      }, 'https://chat.example.com');
    });
  });

  it('keeps the fallback code available when QR generation fails', async () => {
    mockCreateDeviceIdentity.mockResolvedValue({
      publicKeyBase64: 'device-public-key',
    });
    mockCreateSessionKeyPair.mockResolvedValue({
      privateKey: { type: 'private-key' },
      publicKeyBase64: 'session-public-key',
    });
    mockCreateDeviceLinkRequest.mockResolvedValue({
      requestId: 'req-1',
      secret: 'secret-1',
      code: 'ABCD1234',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
    mockBuildLinkApprovalUrl.mockReturnValue('https://app.gethush.live/link-device?payload=abc');
    mockQrToDataUrl.mockRejectedValue(new Error('canvas unavailable'));
    mockConsumeDeviceLinkResult.mockResolvedValue({ status: 'pending' });

    renderLinkDevice('/link-device?mode=new');

    expect(await screen.findByText('ABCD1234')).toBeInTheDocument();
    expect(screen.queryByAltText(/device link qr code/i)).not.toBeInTheDocument();
    expect(screen.getByText(/qr unavailable\. use the fallback code below\./i)).toBeInTheDocument();
  });

  it('shows a request failure state when the new-device link request cannot be created', async () => {
    mockCreateDeviceIdentity.mockResolvedValue({
      publicKeyBase64: 'device-public-key',
    });
    mockCreateSessionKeyPair.mockResolvedValue({
      privateKey: { type: 'private-key' },
      publicKeyBase64: 'session-public-key',
    });
    mockCreateDeviceLinkRequest.mockRejectedValue(
      new Error('create device link request failed. Could not reach https://chat.example.com/api/auth/link-request.'),
    );

    renderLinkDevice('/link-device?mode=new');

    expect(await screen.findByText(/could not create link request\./i)).toBeInTheDocument();
    expect(screen.getByText(/could not reach https:\/\/chat\.example\.com\/api\/auth\/link-request/i)).toBeInTheDocument();
  });

  it('resolves a fallback code and approves the requested device', async () => {
    const user = userEvent.setup();
    const historyDb = { close: vi.fn() };

    authState.current = {
      completeDeviceLink: vi.fn(),
      loading: false,
      isAuthenticated: true,
      vaultState: 'unlocked',
      token: 'jwt-token',
      user: { id: 'user-1', username: 'alice', displayName: 'Alice' },
      identityKeyRef: {
        current: {
          privateKey: new Uint8Array([1, 2, 3]),
          publicKey: new Uint8Array([4, 5, 6]),
        },
      },
    };

    mockResolveDeviceLinkRequest.mockResolvedValue({
      claimToken: 'claim-1',
      deviceId: 'device-2',
      devicePublicKey: 'device-public-key',
      sessionPublicKey: 'session-public-key',
      instanceUrl: 'https://app.gethush.live',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
    mockOpenStore.mockResolvedValue(historyDb);
    mockExportHistorySnapshot.mockResolvedValue({ version: 1, stores: {} });
    mockEncodeTransferBundle.mockReturnValue(new Uint8Array([1, 2, 3]));
    mockBase64ToBytes.mockReturnValue(new Uint8Array([9, 9, 9]));
    mockCertifyDevice.mockResolvedValue(new Uint8Array([7, 7, 7]));
    mockBytesToBase64.mockReturnValue('certificate-base64');
    mockEncryptRelayPayload.mockResolvedValue({
      relayCiphertext: 'ciphertext',
      relayIv: 'relay-iv',
      relayPublicKey: 'relay-public-key',
    });
    mockVerifyDeviceLinkRequest.mockResolvedValue(undefined);

    renderLinkDevice('/link-device');

    await user.type(screen.getByLabelText(/link code/i), 'abcd1234');
    await user.click(screen.getByRole('button', { name: /resolve code/i }));

    expect(await screen.findByText('device-2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /approve link/i }));

    await waitFor(() => {
      expect(mockVerifyDeviceLinkRequest).toHaveBeenCalledWith('jwt-token', {
        claimToken: 'claim-1',
        certificate: 'certificate-base64',
        signingDeviceId: 'device-1',
        relayCiphertext: 'ciphertext',
        relayIv: 'relay-iv',
        relayPublicKey: 'relay-public-key',
      });
    });
    expect(historyDb.close).toHaveBeenCalledTimes(1);
  });
});
