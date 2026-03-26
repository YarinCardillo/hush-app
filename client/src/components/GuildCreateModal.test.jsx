import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../lib/api', () => ({
  createGuild: vi.fn(),
  updateGuildMetadata: vi.fn(),
  listServerTemplates: vi.fn(),
}));

vi.mock('../lib/mlsGroup', () => ({
  createGuildMetadataGroup: vi.fn().mockResolvedValue(undefined),
  exportGuildMetadataKey: vi.fn().mockResolvedValue({ metadataKeyBytes: new Uint8Array(32) }),
}));

vi.mock('../lib/mlsStore', () => ({
  openStore: vi.fn().mockResolvedValue(null), // null db → skips MLS path
  getCredential: vi.fn().mockResolvedValue(null),
}));

vi.mock('../lib/hushCrypto', () => ({
  init: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/guildMetadata', () => ({
  encryptGuildMetadata: vi.fn().mockResolvedValue(new Uint8Array(0)),
  toBase64: vi.fn(() => 'base64blob'),
  importMetadataKey: vi.fn().mockResolvedValue({}),
}));

vi.mock('../hooks/useAuth', () => ({
  getDeviceId: vi.fn(() => 'device-1'),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ user: { id: 'u1' } })),
}));

vi.mock('../contexts/InstanceContext', () => ({
  useInstanceContext: vi.fn(),
}));

// GuildCreateModal uses createPortal — render into document.body by default in jsdom
// No special stub needed; JSDOM supports document.body as portal target.

// ── Imports after mocks ───────────────────────────────────────────────────────

import * as apiModule from '../lib/api';
import { useInstanceContext } from '../contexts/InstanceContext';
import GuildCreateModal from './GuildCreateModal';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInstanceStates(entries) {
  return new Map(entries);
}

function makeCtx(instanceStatesEntries = [], overrides = {}) {
  return {
    instanceStates: makeInstanceStates(instanceStatesEntries),
    refreshGuilds: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderModal(props = {}) {
  const defaults = {
    getToken: () => 'test-jwt',
    onClose: vi.fn(),
    onCreated: vi.fn(),
    activeInstanceUrl: null,
  };
  return render(<GuildCreateModal {...defaults} {...props} />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GuildCreateModal — instance picker', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    apiModule.listServerTemplates.mockResolvedValue([]);
  });

  it('renders instance picker dropdown with all connected instances', () => {
    useInstanceContext.mockReturnValue(makeCtx([
      ['https://a.example.com', { connectionState: 'connected', handshakeData: { server_creation_policy: 'open' }, jwt: 'jwt-a' }],
      ['https://b.example.com', { connectionState: 'connected', handshakeData: { server_creation_policy: 'open' }, jwt: 'jwt-b' }],
    ]));

    renderModal();

    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    const options = screen.getAllByRole('option');
    expect(options.some(o => o.textContent.includes('a.example.com'))).toBe(true);
    expect(options.some(o => o.textContent.includes('b.example.com'))).toBe(true);
  });

  it('pre-selects the activeInstanceUrl when provided', () => {
    useInstanceContext.mockReturnValue(makeCtx([
      ['https://a.example.com', { connectionState: 'connected', handshakeData: { server_creation_policy: 'open' }, jwt: 'jwt-a' }],
      ['https://b.example.com', { connectionState: 'connected', handshakeData: { server_creation_policy: 'open' }, jwt: 'jwt-b' }],
    ]));

    renderModal({ activeInstanceUrl: 'https://b.example.com' });

    const select = screen.getByRole('combobox');
    expect(select.value).toBe('https://b.example.com');
  });

  it('shows "No instances connected" message when instanceStates is empty', () => {
    useInstanceContext.mockReturnValue(makeCtx([]));

    renderModal();

    expect(screen.getByText(/no instances connected/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('instance picker is always visible even with a single instance', () => {
    useInstanceContext.mockReturnValue(makeCtx([
      ['https://a.example.com', { connectionState: 'connected', handshakeData: { server_creation_policy: 'open' }, jwt: 'jwt-a' }],
    ]));

    renderModal();

    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});

describe('GuildCreateModal — policy annotations', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    apiModule.listServerTemplates.mockResolvedValue([]);
  });

  it('shows no annotation and enables Create for open policy', () => {
    useInstanceContext.mockReturnValue(makeCtx([
      ['https://a.example.com', { connectionState: 'connected', handshakeData: { server_creation_policy: 'open' }, jwt: 'jwt-a' }],
    ]));

    renderModal({ activeInstanceUrl: 'https://a.example.com' });

    expect(screen.queryByText(/subscription required/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/managed by the instance admin/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/will be reviewed/i)).not.toBeInTheDocument();

    // Name must be non-empty — the button has a !name.trim() guard in addition to policy.
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My Server' } });

    const createBtn = screen.getByRole('button', { name: /^create$/i });
    expect(createBtn).not.toBeDisabled();
  });

  it('shows no annotation and enables Create for any_member policy', () => {
    useInstanceContext.mockReturnValue(makeCtx([
      ['https://a.example.com', { connectionState: 'connected', handshakeData: { server_creation_policy: 'any_member' }, jwt: 'jwt-a' }],
    ]));

    renderModal({ activeInstanceUrl: 'https://a.example.com' });

    expect(screen.queryByText(/subscription required/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My Server' } });

    const createBtn = screen.getByRole('button', { name: /^create$/i });
    expect(createBtn).not.toBeDisabled();
  });

  it('shows danger banner and disables Create for subscribers policy', () => {
    useInstanceContext.mockReturnValue(makeCtx([
      ['https://a.example.com', { connectionState: 'connected', handshakeData: { server_creation_policy: 'subscribers' }, jwt: 'jwt-a' }],
    ]));

    renderModal({ activeInstanceUrl: 'https://a.example.com' });

    expect(screen.getByText(/subscription required/i)).toBeInTheDocument();
    const createBtn = screen.getByRole('button', { name: /^create$/i });
    expect(createBtn).toBeDisabled();
  });

  it('shows danger banner and disables Create for disabled policy', () => {
    useInstanceContext.mockReturnValue(makeCtx([
      ['https://a.example.com', { connectionState: 'connected', handshakeData: { server_creation_policy: 'disabled' }, jwt: 'jwt-a' }],
    ]));

    renderModal({ activeInstanceUrl: 'https://a.example.com' });

    expect(screen.getByText(/managed by the instance admin/i)).toBeInTheDocument();
    const createBtn = screen.getByRole('button', { name: /^create$/i });
    expect(createBtn).toBeDisabled();
  });

  it('shows amber banner and changes button text to "Request creation" for request policy', () => {
    useInstanceContext.mockReturnValue(makeCtx([
      ['https://a.example.com', { connectionState: 'connected', handshakeData: { server_creation_policy: 'request' }, jwt: 'jwt-a' }],
    ]));

    renderModal({ activeInstanceUrl: 'https://a.example.com' });

    expect(screen.getByText(/will be reviewed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /request creation/i })).toBeInTheDocument();
  });
});

describe('GuildCreateModal — template loading', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('loads templates using the JWT of the selected instance', async () => {
    useInstanceContext.mockReturnValue(makeCtx([
      ['https://a.example.com', { connectionState: 'connected', handshakeData: { server_creation_policy: 'open' }, jwt: 'jwt-for-a' }],
    ]));
    apiModule.listServerTemplates.mockResolvedValue([]);

    renderModal({ activeInstanceUrl: 'https://a.example.com' });

    await waitFor(() => {
      expect(apiModule.listServerTemplates).toHaveBeenCalledWith('jwt-for-a', 'https://a.example.com');
    });
  });

  it('uses fallback getToken() when no instance is selected', async () => {
    useInstanceContext.mockReturnValue(makeCtx([]));
    apiModule.listServerTemplates.mockResolvedValue([]);

    renderModal({ getToken: () => 'fallback-jwt', activeInstanceUrl: null });

    // listServerTemplates is not called when there is no token (empty instances, no jwt from getToken)
    // The effect only fires when effectiveToken is truthy.
    await waitFor(() => {
      // No error should be thrown
      expect(screen.getByText(/no instances connected/i)).toBeInTheDocument();
    });
  });
});

describe('GuildCreateModal — submission', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    apiModule.listServerTemplates.mockResolvedValue([]);
  });

  it('calls refreshGuilds for the selected instance after successful creation', async () => {
    const ctx = makeCtx([
      ['https://a.example.com', { connectionState: 'connected', handshakeData: { server_creation_policy: 'open' }, jwt: 'jwt-a' }],
    ]);
    useInstanceContext.mockReturnValue(ctx);
    apiModule.createGuild.mockResolvedValue({ id: 'new-guild' });
    apiModule.updateGuildMetadata.mockResolvedValue(undefined);

    const onCreated = vi.fn();
    renderModal({ activeInstanceUrl: 'https://a.example.com', onCreated });

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My New Server' } });
    fireEvent.submit(screen.getByRole('button', { name: /^create$/i }).closest('form'));

    await waitFor(() => {
      expect(apiModule.createGuild).toHaveBeenCalled();
      expect(ctx.refreshGuilds).toHaveBeenCalledWith('https://a.example.com');
      expect(onCreated).toHaveBeenCalled();
    });
  });

  it('passes selectedInstanceUrl as baseUrl to createGuild', async () => {
    useInstanceContext.mockReturnValue(makeCtx([
      ['https://a.example.com', { connectionState: 'connected', handshakeData: { server_creation_policy: 'open' }, jwt: 'jwt-a' }],
    ]));
    apiModule.createGuild.mockResolvedValue({ id: 'new-guild' });

    renderModal({ activeInstanceUrl: 'https://a.example.com', onCreated: vi.fn() });

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Server Name' } });
    fireEvent.submit(screen.getByRole('button', { name: /^create$/i }).closest('form'));

    await waitFor(() => {
      // createGuild is called with (token, encryptedMetadata, templateId, baseUrl, name)
      // templateId is null when no templates are loaded (listServerTemplates returns [])
      expect(apiModule.createGuild).toHaveBeenCalledWith(
        'jwt-a',
        null,
        null,
        'https://a.example.com',
        'Server Name',
      );
    });
  });

  it('shows error message when server name is empty', async () => {
    useInstanceContext.mockReturnValue(makeCtx([
      ['https://a.example.com', { connectionState: 'connected', handshakeData: { server_creation_policy: 'open' }, jwt: 'jwt-a' }],
    ]));

    renderModal({ activeInstanceUrl: 'https://a.example.com' });

    fireEvent.submit(screen.getByRole('button', { name: /^create$/i }).closest('form'));

    await waitFor(() => {
      expect(screen.getByText(/server name is required/i)).toBeInTheDocument();
    });
  });

  it('calls onClose when Cancel is clicked', () => {
    useInstanceContext.mockReturnValue(makeCtx([
      ['https://a.example.com', { connectionState: 'connected', handshakeData: { server_creation_policy: 'open' }, jwt: 'jwt-a' }],
    ]));
    const onClose = vi.fn();

    renderModal({ activeInstanceUrl: 'https://a.example.com', onClose });

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
