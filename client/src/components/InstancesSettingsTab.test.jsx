import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { InstanceContext } from '../contexts/InstanceContext.jsx';
import InstancesSettingsTab from './InstancesSettingsTab';

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderWithCtx(instanceStates, disconnectInstance = vi.fn()) {
  return render(
    <InstanceContext.Provider value={{ instanceStates, disconnectInstance }}>
      <InstancesSettingsTab />
    </InstanceContext.Provider>,
  );
}

function makeState(connectionState, guilds = []) {
  return { connectionState, guilds };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('InstancesSettingsTab — empty state', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders empty state when no instances are connected', () => {
    renderWithCtx(new Map());

    expect(screen.getByText(/no instances connected/i)).toBeInTheDocument();
  });

  it('renders without InstanceContext (graceful degradation)', () => {
    // Render outside any InstanceContext.Provider
    render(<InstancesSettingsTab />);

    expect(screen.getByText(/no instances connected/i)).toBeInTheDocument();
  });
});

describe('InstancesSettingsTab — instance list', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders a row for each connected instance', () => {
    const instanceStates = new Map([
      ['https://a.example.com', makeState('connected', [{ id: 'g1' }])],
      ['https://b.example.com', makeState('connected', [{ id: 'g2' }, { id: 'g3' }])],
    ]);

    renderWithCtx(instanceStates);

    expect(screen.getByText('a.example.com')).toBeInTheDocument();
    expect(screen.getByText('b.example.com')).toBeInTheDocument();
  });

  it('shows correct server count per instance', () => {
    const instanceStates = new Map([
      ['https://a.example.com', makeState('connected', [{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }])],
      ['https://b.example.com', makeState('connected', [])],
    ]);

    renderWithCtx(instanceStates);

    expect(screen.getByText(/3 servers/i)).toBeInTheDocument();
    expect(screen.getByText(/no servers/i)).toBeInTheDocument();
  });

  it('shows "1 server" (singular) when instance has exactly one guild', () => {
    const instanceStates = new Map([
      ['https://a.example.com', makeState('connected', [{ id: 'g1' }])],
    ]);

    renderWithCtx(instanceStates);

    expect(screen.getByText(/1 server/i)).toBeInTheDocument();
  });
});

describe('InstancesSettingsTab — connection status indicator', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders a status indicator dot for each instance', () => {
    const instanceStates = new Map([
      ['https://a.example.com', makeState('connected')],
    ]);

    renderWithCtx(instanceStates);

    // Status dot has a title attribute matching the state label
    const dot = screen.getByTitle('connected');
    expect(dot).toBeInTheDocument();
  });

  it('shows "connected" label for connected instances', () => {
    const instanceStates = new Map([
      ['https://a.example.com', makeState('connected')],
    ]);

    renderWithCtx(instanceStates);

    expect(screen.getByText('connected')).toBeInTheDocument();
  });

  it('shows "reconnecting" label for reconnecting instances', () => {
    const instanceStates = new Map([
      ['https://a.example.com', makeState('reconnecting')],
    ]);

    renderWithCtx(instanceStates);

    expect(screen.getByText('reconnecting')).toBeInTheDocument();
  });

  it('shows "offline" label for instances with unknown connection state', () => {
    const instanceStates = new Map([
      ['https://a.example.com', makeState('offline')],
    ]);

    renderWithCtx(instanceStates);

    expect(screen.getByText('offline')).toBeInTheDocument();
  });
});

describe('InstancesSettingsTab — disconnect flow', () => {
  beforeEach(() => {
    cleanup();
  });

  it('Disconnect button triggers inline confirmation panel', () => {
    const instanceStates = new Map([
      ['https://a.example.com', makeState('connected', [{ id: 'g1' }])],
    ]);

    renderWithCtx(instanceStates);

    fireEvent.click(screen.getByRole('button', { name: /disconnect/i }));

    // Confirmation panel appears
    expect(screen.getByText(/disconnect from/i)).toBeInTheDocument();
  });

  it('confirmation panel shows instance domain and server count', () => {
    const instanceStates = new Map([
      ['https://a.example.com', makeState('connected', [{ id: 'g1' }, { id: 'g2' }])],
    ]);

    renderWithCtx(instanceStates);

    fireEvent.click(screen.getByRole('button', { name: /disconnect/i }));

    // Domain appears at least once in the confirm text (may also appear in the row label)
    expect(screen.getAllByText(/a\.example\.com/).length).toBeGreaterThan(0);
    // Server count appears in the confirm message
    expect(screen.getAllByText(/2 servers/i).length).toBeGreaterThan(0);
  });

  it('confirming disconnect calls disconnectInstance with the instanceUrl', async () => {
    const disconnectInstance = vi.fn().mockResolvedValue(undefined);
    const instanceStates = new Map([
      ['https://a.example.com', makeState('connected', [{ id: 'g1' }])],
    ]);

    renderWithCtx(instanceStates, disconnectInstance);

    fireEvent.click(screen.getByRole('button', { name: /^disconnect$/i }));

    // Confirm button in the inline panel
    const confirmBtn = screen.getAllByRole('button', { name: /^disconnect$/i }).find(
      (b) => b.className.includes('btn-danger') || b.textContent === 'Disconnect',
    );
    // Click the Disconnect button inside the confirmation panel (last one rendered)
    const allDisconnectBtns = screen.getAllByRole('button', { name: /disconnect/i });
    // The confirmation "Disconnect" button is the last one
    fireEvent.click(allDisconnectBtns[allDisconnectBtns.length - 1]);

    await waitFor(() => {
      expect(disconnectInstance).toHaveBeenCalledWith('https://a.example.com');
    });
  });

  it('cancelling keeps the instance in place', () => {
    const disconnectInstance = vi.fn();
    const instanceStates = new Map([
      ['https://a.example.com', makeState('connected', [{ id: 'g1' }])],
    ]);

    renderWithCtx(instanceStates, disconnectInstance);

    fireEvent.click(screen.getByRole('button', { name: /^disconnect$/i }));

    // Panel shows Cancel
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(disconnectInstance).not.toHaveBeenCalled();
    // Disconnect button should be visible again (confirmation hidden)
    expect(screen.getByRole('button', { name: /^disconnect$/i })).toBeInTheDocument();
  });
});
