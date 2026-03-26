import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import GuildContextMenu from './GuildContextMenu';

// GuildContextMenu renders via createPortal into document.body.
// Testing Library's render appends to document.body by default, so portal rendering works.

// ── Helpers ───────────────────────────────────────────────────────────────────

const GUILD = { id: 'g1', name: 'Alpha Guild' };
const INSTANCE_URL = 'https://a.example.com';
const POSITION = { x: 100, y: 200 };

function renderMenu(props = {}) {
  const defaults = {
    guild: GUILD,
    instanceUrl: INSTANCE_URL,
    position: POSITION,
    connectionState: 'connected',
    userPermissionLevel: 0,
    onClose: vi.fn(),
    onLeave: vi.fn(),
    onMute: vi.fn(),
    onCopyInvite: vi.fn(),
    onMarkRead: vi.fn(),
    onSettings: vi.fn(),
    onInstanceInfo: vi.fn(),
  };
  return render(<GuildContextMenu {...defaults} {...props} />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GuildContextMenu — positioning and structure', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders with role="menu"', () => {
    renderMenu();
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('menu is positioned at the given coordinates', () => {
    renderMenu({ position: { x: 150, y: 300 } });
    const menu = screen.getByRole('menu');
    expect(menu.style.top).toBe('300px');
    expect(menu.style.left).toBe('150px');
  });

  it('shows instance domain as header label', () => {
    renderMenu({ instanceUrl: 'https://test.hush.io' });
    expect(screen.getByText(/test\.hush\.io/i)).toBeInTheDocument();
  });

  it('shows "offline" badge when connectionState is not connected', () => {
    renderMenu({ connectionState: 'offline' });
    expect(screen.getByText(/offline/i)).toBeInTheDocument();
  });

  it('does not show offline badge when instance is connected', () => {
    renderMenu({ connectionState: 'connected' });
    // The menu header shows domain but no "offline" label within
    const menu = screen.getByRole('menu');
    // There should be no span with "offline" text inside the header area
    // (the offline badge is conditional on isOffline)
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
  });
});

describe('GuildContextMenu — actions', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders Mark as read action', () => {
    renderMenu();
    expect(screen.getByRole('menuitem', { name: /mark as read/i })).toBeInTheDocument();
  });

  it('renders Copy invite link action', () => {
    renderMenu();
    expect(screen.getByRole('menuitem', { name: /copy invite link/i })).toBeInTheDocument();
  });

  it('renders Mute notifications action', () => {
    renderMenu();
    expect(screen.getByRole('menuitem', { name: /mute notifications/i })).toBeInTheDocument();
  });

  it('renders Instance info action', () => {
    renderMenu();
    expect(screen.getByRole('menuitem', { name: /instance info/i })).toBeInTheDocument();
  });

  it('renders Leave server action', () => {
    renderMenu();
    expect(screen.getByRole('menuitem', { name: /leave server/i })).toBeInTheDocument();
  });

  it('Mark as read fires onMarkRead callback and closes menu', () => {
    const onMarkRead = vi.fn();
    const onClose = vi.fn();
    renderMenu({ onMarkRead, onClose });

    fireEvent.click(screen.getByRole('menuitem', { name: /mark as read/i }));

    expect(onMarkRead).toHaveBeenCalledWith(GUILD);
    expect(onClose).toHaveBeenCalled();
  });

  it('Copy invite link fires onCopyInvite callback and closes menu', () => {
    const onCopyInvite = vi.fn();
    const onClose = vi.fn();
    renderMenu({ onCopyInvite, onClose });

    fireEvent.click(screen.getByRole('menuitem', { name: /copy invite link/i }));

    expect(onCopyInvite).toHaveBeenCalledWith(GUILD);
    expect(onClose).toHaveBeenCalled();
  });

  it('Instance info fires onInstanceInfo callback and closes menu', () => {
    const onInstanceInfo = vi.fn();
    const onClose = vi.fn();
    renderMenu({ onInstanceInfo, onClose });

    fireEvent.click(screen.getByRole('menuitem', { name: /instance info/i }));

    expect(onInstanceInfo).toHaveBeenCalledWith(GUILD, INSTANCE_URL);
    expect(onClose).toHaveBeenCalled();
  });

  it('Leave server fires onLeave callback and closes menu', () => {
    const onLeave = vi.fn();
    const onClose = vi.fn();
    renderMenu({ onLeave, onClose });

    fireEvent.click(screen.getByRole('menuitem', { name: /leave server/i }));

    expect(onLeave).toHaveBeenCalledWith(GUILD);
    expect(onClose).toHaveBeenCalled();
  });

  it('Copy invite link is disabled when instance is offline', () => {
    renderMenu({ connectionState: 'offline' });
    const copyBtn = screen.getByRole('menuitem', { name: /copy invite link/i });
    expect(copyBtn).toBeDisabled();
  });
});

describe('GuildContextMenu — Settings visibility', () => {
  beforeEach(() => {
    cleanup();
  });

  it('Server settings action is NOT shown for members (permissionLevel < 2)', () => {
    renderMenu({ userPermissionLevel: 0 });
    expect(screen.queryByRole('menuitem', { name: /server settings/i })).not.toBeInTheDocument();
  });

  it('Server settings action is NOT shown for permissionLevel 1', () => {
    renderMenu({ userPermissionLevel: 1 });
    expect(screen.queryByRole('menuitem', { name: /server settings/i })).not.toBeInTheDocument();
  });

  it('Server settings action IS shown for admins (permissionLevel >= 2)', () => {
    renderMenu({ userPermissionLevel: 2 });
    expect(screen.getByRole('menuitem', { name: /server settings/i })).toBeInTheDocument();
  });

  it('Server settings fires onSettings callback for admin', () => {
    const onSettings = vi.fn();
    const onClose = vi.fn();
    renderMenu({ userPermissionLevel: 2, onSettings, onClose });

    fireEvent.click(screen.getByRole('menuitem', { name: /server settings/i }));

    expect(onSettings).toHaveBeenCalledWith(GUILD);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('GuildContextMenu — Mute submenu', () => {
  beforeEach(() => {
    cleanup();
  });

  it('mute submenu appears when hovering Mute notifications', () => {
    renderMenu();
    const muteRow = screen.getByRole('menuitem', { name: /mute notifications/i });
    fireEvent.mouseEnter(muteRow);

    expect(screen.getByText('1 hour')).toBeInTheDocument();
    expect(screen.getByText('8 hours')).toBeInTheDocument();
    expect(screen.getByText('24 hours')).toBeInTheDocument();
    expect(screen.getByText('Forever')).toBeInTheDocument();
  });

  it('clicking 1 hour calls onMute with correct ms duration', () => {
    const onMute = vi.fn();
    renderMenu({ onMute });

    const muteRow = screen.getByRole('menuitem', { name: /mute notifications/i });
    fireEvent.mouseEnter(muteRow);

    fireEvent.click(screen.getByText('1 hour'));

    expect(onMute).toHaveBeenCalledWith(GUILD, 60 * 60 * 1000);
  });

  it('clicking Forever calls onMute with null duration', () => {
    const onMute = vi.fn();
    renderMenu({ onMute });

    const muteRow = screen.getByRole('menuitem', { name: /mute notifications/i });
    fireEvent.mouseEnter(muteRow);

    fireEvent.click(screen.getByText('Forever'));

    expect(onMute).toHaveBeenCalledWith(GUILD, null);
  });

  it('mute submenu disappears when mouse leaves', () => {
    renderMenu();
    const muteRow = screen.getByRole('menuitem', { name: /mute notifications/i });
    fireEvent.mouseEnter(muteRow);
    expect(screen.getByText('1 hour')).toBeInTheDocument();

    fireEvent.mouseLeave(muteRow);
    expect(screen.queryByText('1 hour')).not.toBeInTheDocument();
  });
});

describe('GuildContextMenu — dismiss behaviors', () => {
  beforeEach(() => {
    cleanup();
  });

  it('Escape key calls onClose', () => {
    const onClose = vi.fn();
    renderMenu({ onClose });

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('outside click calls onClose', () => {
    const onClose = vi.fn();
    renderMenu({ onClose });

    // Pointer down outside the menu
    fireEvent.pointerDown(document.body);

    expect(onClose).toHaveBeenCalled();
  });

  it('click inside menu does NOT call onClose unexpectedly', () => {
    const onClose = vi.fn();
    renderMenu({ onClose });

    // Click inside the menu element itself
    const menu = screen.getByRole('menu');
    fireEvent.pointerDown(menu);

    // onClose should not be called by clicking inside
    expect(onClose).not.toHaveBeenCalled();
  });
});
