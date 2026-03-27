import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ServerList from './ServerList';
import { InstanceContext } from '../contexts/InstanceContext.jsx';

// GuildCreateModal calls createGuild — mock it so the modal renders without real API calls
vi.mock('../lib/api', () => ({
  createGuild: vi.fn(() => Promise.resolve({ id: 'g-new', name: 'New Guild' })),
}));

// UserSettingsModal requires matchMedia — mock the whole component
vi.mock('./UserSettingsModal', () => ({
  default: function MockUserSettingsModal({ onClose }) {
    return <div data-testid="user-settings"><button onClick={onClose}>Close</button></div>;
  },
  applyThemeMode: vi.fn(),
  getStoredThemeMode: vi.fn(() => 'dark'),
}));

// GuildCreateModal references createGuild — mock it
vi.mock('./GuildCreateModal', () => ({
  default: function MockGuildCreateModal({ onClose, onCreated }) {
    return (
      <div data-testid="guild-create-modal">
        <button onClick={() => onCreated({ id: 'g-new', name: 'New Guild' })}>Create</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    );
  },
}));

// AuthContext
vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ user: { id: 'u1', displayName: 'Test User' } })),
  AuthProvider: ({ children }) => children,
}));

// guildMetadata — no real crypto in tests
vi.mock('../lib/guildMetadata', () => ({
  decryptGuildMetadata: vi.fn(() => Promise.resolve({ name: 'Decrypted Name', icon: null })),
  fromBase64: vi.fn((v) => v),
  importMetadataKey: vi.fn(() => Promise.resolve({})),
}));

const getToken = () => 'test-token';

const guilds = [
  { id: 'g1', name: 'Alpha Guild', ownerId: 'u1' },
  { id: 'g2', name: 'Beta', ownerId: 'u2' },
];

const multiInstanceGuilds = [
  { id: 'g1', name: 'Alpha Guild', ownerId: 'u1', instanceUrl: 'https://a.example.com' },
  { id: 'g2', name: 'Beta', ownerId: 'u2', instanceUrl: 'https://b.example.com' },
  { id: 'g3', name: 'Gamma', ownerId: 'u3', instanceUrl: 'https://a.example.com' },
];

/** Renders ServerList inside an InstanceContext.Provider with the given value. */
function renderWithInstanceCtx(ctxValue, props = {}) {
  return render(
    <InstanceContext.Provider value={ctxValue}>
      <ServerList
        getToken={getToken}
        activeGuild={null}
        onGuildSelect={() => {}}
        onGuildCreated={() => {}}
        instanceData={null}
        userRole="member"
        {...props}
      />
    </InstanceContext.Provider>,
  );
}

describe('ServerList — legacy prop-based mode', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders guild initials for each guild', () => {
    render(
      <ServerList
        getToken={getToken}
        guilds={guilds}
        activeGuild={null}
        onGuildSelect={() => {}}
        onGuildCreated={() => {}}
        instanceData={null}
        userRole="member"
      />,
    );
    // In legacy mode (no instanceUrl), tooltip is just the name.
    expect(screen.getByTitle('Alpha Guild')).toBeInTheDocument();
    expect(screen.getByTitle('Beta')).toBeInTheDocument();
    expect(screen.getByText('AG')).toBeInTheDocument();
    expect(screen.getByText('BE')).toBeInTheDocument();
  });

  it('active guild button has amber border style', () => {
    render(
      <ServerList
        getToken={getToken}
        guilds={guilds}
        activeGuild={guilds[0]}
        onGuildSelect={() => {}}
        onGuildCreated={() => {}}
        instanceData={null}
        userRole="member"
      />,
    );
    // aria-pressed comes from our own prop on the button, not overridden by dnd-kit in jsdom
    const activeBtn = screen.getByTitle('Alpha Guild');
    const inactiveBtn = screen.getByTitle('Beta');
    // Active button has sl-guild-btn--active class (amber state handled in CSS)
    expect(activeBtn.className).toContain('sl-guild-btn--active');
    // Inactive button does not have the active modifier class
    expect(inactiveBtn.className).not.toContain('sl-guild-btn--active');
  });

  it('calls onGuildSelect when a guild button is clicked', () => {
    const onSelect = vi.fn();
    render(
      <ServerList
        getToken={getToken}
        guilds={guilds}
        activeGuild={null}
        onGuildSelect={onSelect}
        onGuildCreated={() => {}}
        instanceData={null}
        userRole="member"
      />,
    );
    fireEvent.click(screen.getByTitle('Alpha Guild'));
    expect(onSelect).toHaveBeenCalledWith(guilds[0]);
  });

  it('shows + button when policy is open', () => {
    render(
      <ServerList
        getToken={getToken}
        guilds={[]}
        activeGuild={null}
        onGuildSelect={() => {}}
        onGuildCreated={() => {}}
        instanceData={{ serverCreationPolicy: 'open' }}
        userRole="member"
      />,
    );
    expect(screen.getByTitle('Create a server')).toBeInTheDocument();
  });

  it('hides + button when policy is admin_only and user is member', () => {
    render(
      <ServerList
        getToken={getToken}
        guilds={[]}
        activeGuild={null}
        onGuildSelect={() => {}}
        onGuildCreated={() => {}}
        instanceData={{ serverCreationPolicy: 'admin_only' }}
        userRole="member"
      />,
    );
    expect(screen.queryByTitle('Create a server')).not.toBeInTheDocument();
  });

  it('shows + button when policy is admin_only and user is admin', () => {
    render(
      <ServerList
        getToken={getToken}
        guilds={[]}
        activeGuild={null}
        onGuildSelect={() => {}}
        onGuildCreated={() => {}}
        instanceData={{ serverCreationPolicy: 'admin_only' }}
        userRole="admin"
      />,
    );
    expect(screen.getByTitle('Create a server')).toBeInTheDocument();
  });
});

describe('ServerList — multi-instance mode via InstanceContext', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders guilds from mergedGuilds when InstanceContext is provided', () => {
    const ctxValue = {
      mergedGuilds: multiInstanceGuilds,
      instanceStates: new Map([
        ['https://a.example.com', { connectionState: 'connected' }],
        ['https://b.example.com', { connectionState: 'connected' }],
      ]),
      guildOrder: [],
      setGuildOrder: vi.fn(),
    };
    renderWithInstanceCtx(ctxValue);
    // Guilds should be rendered by aria-label
    expect(screen.getByLabelText('Alpha Guild')).toBeInTheDocument();
    expect(screen.getByLabelText('Beta')).toBeInTheDocument();
    expect(screen.getByLabelText('Gamma')).toBeInTheDocument();
  });

  it('tooltip includes instance domain for multi-instance guilds', () => {
    const ctxValue = {
      mergedGuilds: [{ id: 'g1', name: 'Alpha Guild', instanceUrl: 'https://a.example.com' }],
      instanceStates: new Map([['https://a.example.com', { connectionState: 'connected' }]]),
      guildOrder: [],
      setGuildOrder: vi.fn(),
    };
    renderWithInstanceCtx(ctxValue);
    const btn = screen.getByLabelText('Alpha Guild');
    // Title should contain the domain
    expect(btn.getAttribute('title')).toContain('a.example.com');
  });

  it('applies 0.5 opacity to guilds from offline instances', () => {
    const ctxValue = {
      mergedGuilds: [
        { id: 'g1', name: 'Online Guild', instanceUrl: 'https://a.example.com' },
        { id: 'g2', name: 'Offline Guild', instanceUrl: 'https://b.example.com' },
      ],
      instanceStates: new Map([
        ['https://a.example.com', { connectionState: 'connected' }],
        ['https://b.example.com', { connectionState: 'offline' }],
      ]),
      guildOrder: [],
      setGuildOrder: vi.fn(),
    };
    renderWithInstanceCtx(ctxValue);
    const onlineBtn = screen.getByLabelText('Online Guild');
    const offlineBtn = screen.getByLabelText('Offline Guild');
    // Offline state handled by sl-guild-btn--offline CSS class (opacity: 0.5 in CSS)
    expect(onlineBtn.className).not.toContain('sl-guild-btn--offline');
    expect(offlineBtn.className).toContain('sl-guild-btn--offline');
  });

  it('renders DM section at top of sidebar', () => {
    const ctxValue = {
      mergedGuilds: multiInstanceGuilds,
      instanceStates: new Map(),
      guildOrder: [],
      setGuildOrder: vi.fn(),
    };
    renderWithInstanceCtx(ctxValue);
    expect(screen.getByTestId('dm-section')).toBeInTheDocument();
    expect(screen.getByTitle('Direct Messages')).toBeInTheDocument();
  });

  it('shows context menu on right-click', () => {
    const ctxValue = {
      mergedGuilds: multiInstanceGuilds,
      instanceStates: new Map([
        ['https://a.example.com', { connectionState: 'connected' }],
      ]),
      guildOrder: [],
      setGuildOrder: vi.fn(),
    };
    renderWithInstanceCtx(ctxValue);
    const guildBtn = screen.getByLabelText('Alpha Guild');
    fireEvent.contextMenu(guildBtn, { clientX: 100, clientY: 200 });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('Leave server')).toBeInTheDocument();
    expect(screen.getByText('Mark as read')).toBeInTheDocument();
    expect(screen.getByText('Copy invite link')).toBeInTheDocument();
    expect(screen.getByText('Instance info')).toBeInTheDocument();
    expect(screen.getByText('Mute notifications')).toBeInTheDocument();
  });

  it('closes context menu on Escape key', () => {
    const ctxValue = {
      mergedGuilds: multiInstanceGuilds,
      instanceStates: new Map([
        ['https://a.example.com', { connectionState: 'connected' }],
      ]),
      guildOrder: [],
      setGuildOrder: vi.fn(),
    };
    renderWithInstanceCtx(ctxValue);
    const guildBtn = screen.getByLabelText('Alpha Guild');
    fireEvent.contextMenu(guildBtn, { clientX: 100, clientY: 200 });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('shows Settings action only for admin and above', () => {
    const ctxValue = {
      mergedGuilds: [{ id: 'g1', name: 'Alpha Guild', instanceUrl: 'https://a.example.com' }],
      instanceStates: new Map([
        ['https://a.example.com', { connectionState: 'connected' }],
      ]),
      guildOrder: [],
      setGuildOrder: vi.fn(),
    };

    // Member — no settings visible
    const { unmount } = renderWithInstanceCtx(ctxValue, { userPermissionLevel: 0 });
    const guildBtn = screen.getByLabelText('Alpha Guild');
    fireEvent.contextMenu(guildBtn, { clientX: 100, clientY: 200 });
    expect(screen.queryByText('Server settings')).not.toBeInTheDocument();
    unmount();

    // Admin — settings visible
    cleanup();
    renderWithInstanceCtx(ctxValue, { userPermissionLevel: 2 });
    const guildBtn2 = screen.getByLabelText('Alpha Guild');
    fireEvent.contextMenu(guildBtn2, { clientX: 100, clientY: 200 });
    expect(screen.getByText('Server settings')).toBeInTheDocument();
  });

  it('respects guildOrder from context — reorders displayed guilds', () => {
    const ctxValue = {
      mergedGuilds: multiInstanceGuilds,
      instanceStates: new Map(),
      guildOrder: ['g3', 'g1', 'g2'], // Gamma should appear first
      setGuildOrder: vi.fn(),
    };
    renderWithInstanceCtx(ctxValue);
    // Get all guild buttons by aria-label
    const gammaBtn = screen.getByLabelText('Gamma');
    const alphaBtn = screen.getByLabelText('Alpha Guild');
    // Gamma (g3) has lower DOM order than Alpha (g1) when order is ['g3','g1','g2']
    expect(
      gammaBtn.compareDocumentPosition(alphaBtn) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('ServerList — DM button', () => {
  beforeEach(() => {
    cleanup();
  });

  it('DM button calls onDmOpen when clicked', () => {
    const onDmOpen = vi.fn();
    const ctxValue = {
      mergedGuilds: [],
      instanceStates: new Map(),
      guildOrder: [],
      setGuildOrder: vi.fn(),
    };
    renderWithInstanceCtx(ctxValue, { onDmOpen });
    const dmBtn = screen.getByTitle('Direct Messages');
    fireEvent.click(dmBtn);
    expect(onDmOpen).toHaveBeenCalledTimes(1);
  });
});
