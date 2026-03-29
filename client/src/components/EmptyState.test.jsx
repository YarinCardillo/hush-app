import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import EmptyState from './EmptyState';

describe('EmptyState', () => {
  beforeEach(() => {
    cleanup();
  });

  // ── Static content ──────────────────────────────────────────────────────────

  it('renders the welcome heading', () => {
    render(
      <EmptyState
        instanceStates={new Map()}
        onCreateServer={() => {}}
        onBrowseServers={() => {}}
      />,
    );
    expect(screen.getByRole('heading', { name: /welcome/i })).toBeInTheDocument();
  });

  it('renders Browse public servers button', () => {
    render(
      <EmptyState
        instanceStates={new Map()}
        onCreateServer={() => {}}
        onBrowseServers={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /browse public servers/i })).toBeInTheDocument();
  });

  it('calls onBrowseServers when Browse button is clicked', () => {
    const onBrowse = vi.fn();
    render(
      <EmptyState
        instanceStates={new Map()}
        onCreateServer={() => {}}
        onBrowseServers={onBrowse}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /browse public servers/i }));
    expect(onBrowse).toHaveBeenCalledOnce();
  });

  it('renders invite link explanation text', () => {
    render(
      <EmptyState
        instanceStates={new Map()}
        onCreateServer={() => {}}
        onBrowseServers={() => {}}
      />,
    );
    expect(screen.getByText(/invite link/i)).toBeInTheDocument();
  });

  it('renders Get a server footer link pointing to gethush.live', () => {
    render(
      <EmptyState
        instanceStates={new Map()}
        onCreateServer={() => {}}
        onBrowseServers={() => {}}
      />,
    );
    const link = screen.getByRole('link', { name: /get a server/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('https://gethush.live');
  });

  it('renders Self-host footer link pointing to docs', () => {
    render(
      <EmptyState
        instanceStates={new Map()}
        onCreateServer={() => {}}
        onBrowseServers={() => {}}
      />,
    );
    const link = screen.getByRole('link', { name: /self-host/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('https://gethush.live/docs');
  });

  it('footer links open in a new tab', () => {
    render(
      <EmptyState
        instanceStates={new Map()}
        onCreateServer={() => {}}
        onBrowseServers={() => {}}
      />,
    );
    const getServer = screen.getByRole('link', { name: /get a server/i });
    const selfHost = screen.getByRole('link', { name: /self-host/i });
    expect(getServer.getAttribute('target')).toBe('_blank');
    expect(selfHost.getAttribute('target')).toBe('_blank');
  });

  // ── Conditional Create button ───────────────────────────────────────────────

  it('shows Create a server button when at least one instance has open policy', () => {
    const instanceStates = new Map([
      ['https://a.example.com', {
        connectionState: 'connected',
        handshakeData: { server_creation_policy: 'open' },
      }],
    ]);
    render(
      <EmptyState
        instanceStates={instanceStates}
        onCreateServer={() => {}}
        onBrowseServers={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /create a server/i })).toBeInTheDocument();
  });

  it('hides Create a server button when the instance policy is any_member', () => {
    const instanceStates = new Map([
      ['https://a.example.com', {
        connectionState: 'connected',
        handshakeData: { server_creation_policy: 'any_member' },
      }],
    ]);
    render(
      <EmptyState
        instanceStates={instanceStates}
        onCreateServer={() => {}}
        onBrowseServers={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /create a server/i })).not.toBeInTheDocument();
  });

  it('hides Create a server button when all instances have disabled policy', () => {
    const instanceStates = new Map([
      ['https://a.example.com', {
        connectionState: 'connected',
        handshakeData: { server_creation_policy: 'disabled' },
      }],
    ]);
    render(
      <EmptyState
        instanceStates={instanceStates}
        onCreateServer={() => {}}
        onBrowseServers={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /create a server/i })).not.toBeInTheDocument();
  });

  it('hides Create a server button when all instances have subscribers policy', () => {
    const instanceStates = new Map([
      ['https://a.example.com', {
        connectionState: 'connected',
        handshakeData: { server_creation_policy: 'subscribers' },
      }],
    ]);
    render(
      <EmptyState
        instanceStates={instanceStates}
        onCreateServer={() => {}}
        onBrowseServers={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /create a server/i })).not.toBeInTheDocument();
  });

  it('shows Create button if at least one of multiple instances allows creation', () => {
    const instanceStates = new Map([
      ['https://a.example.com', {
        connectionState: 'connected',
        handshakeData: { server_creation_policy: 'disabled' },
      }],
      ['https://b.example.com', {
        connectionState: 'connected',
        handshakeData: { server_creation_policy: 'open' },
      }],
    ]);
    render(
      <EmptyState
        instanceStates={instanceStates}
        onCreateServer={() => {}}
        onBrowseServers={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /create a server/i })).toBeInTheDocument();
  });

  it('hides Create button when instanceStates is empty (no instances)', () => {
    render(
      <EmptyState
        instanceStates={new Map()}
        onCreateServer={() => {}}
        onBrowseServers={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /create a server/i })).not.toBeInTheDocument();
  });

  it('hides Create button when the open-policy instance is offline', () => {
    const instanceStates = new Map([
      ['https://a.example.com', {
        connectionState: 'offline',
        handshakeData: { server_creation_policy: 'open' },
      }],
    ]);
    render(
      <EmptyState
        instanceStates={instanceStates}
        onCreateServer={() => {}}
        onBrowseServers={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /create a server/i })).not.toBeInTheDocument();
  });

  it('calls onCreateServer when Create button is clicked', () => {
    const onCreate = vi.fn();
    const instanceStates = new Map([
      ['https://a.example.com', {
        connectionState: 'connected',
        handshakeData: { server_creation_policy: 'open' },
      }],
    ]);
    render(
      <EmptyState
        instanceStates={instanceStates}
        onCreateServer={onCreate}
        onBrowseServers={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /create a server/i }));
    expect(onCreate).toHaveBeenCalledOnce();
  });
});
