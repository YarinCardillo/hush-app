import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ServerList from './ServerList';

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

const getToken = () => 'test-token';

const guilds = [
  { id: 'g1', name: 'Alpha Guild', ownerId: 'u1' },
  { id: 'g2', name: 'Beta', ownerId: 'u2' },
];

describe('ServerList', () => {
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
    expect(screen.getByTitle('Alpha Guild')).toBeInTheDocument();
    expect(screen.getByTitle('Beta')).toBeInTheDocument();
    expect(screen.getByText('AG')).toBeInTheDocument();
    expect(screen.getByText('BE')).toBeInTheDocument();
  });

  it('active guild has aria-pressed=true', () => {
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
    const btn = screen.getByTitle('Alpha Guild');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTitle('Beta').getAttribute('aria-pressed')).toBe('false');
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
