import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ExplorePage from './ExplorePage';
import * as api from '../lib/api';
import { InstanceContext } from '../contexts/InstanceContext.jsx';

vi.mock('../lib/api', () => ({
  discoverGuilds: vi.fn(),
  joinGuildFromExplore: vi.fn(),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ user: { id: 'u1' } })),
}));

const MOCK_GUILDS = [
  {
    id: 'g1',
    publicName: 'Gaming Hub',
    publicDescription: 'A place for gamers',
    memberCount: 42,
    category: 'Gaming',
    accessPolicy: 'open',
  },
  {
    id: 'g2',
    publicName: 'Tech Talk',
    publicDescription: 'Discuss the latest in technology',
    memberCount: 128,
    category: 'Technology',
    accessPolicy: 'request',
  },
];

function makeCtx() {
  return {
    instanceStates: new Map([
      ['http://localhost', { connectionState: 'connected', token: 'tok-1' }],
    ]),
    refreshGuilds: vi.fn(() => Promise.resolve()),
    getTokenForInstance: vi.fn(() => 'tok-1'),
  };
}

function renderPage(ctx) {
  return render(
    <MemoryRouter initialEntries={['/explore']}>
      <InstanceContext.Provider value={ctx || makeCtx()}>
        <ExplorePage />
      </InstanceContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  api.discoverGuilds.mockImplementation(() =>
    Promise.resolve({ guilds: MOCK_GUILDS, total: 2, page: 1, pageSize: 20 }),
  );
});

describe('ExplorePage', () => {
  it('renders category tabs including All', async () => {
    renderPage();
    expect(screen.getByTestId('category-tab-All')).toBeTruthy();
    expect(screen.getByTestId('category-tab-Gaming')).toBeTruthy();
    expect(screen.getByTestId('category-tab-Technology')).toBeTruthy();
  });

  it('renders guild cards from discover response', async () => {
    renderPage();
    expect(await screen.findByText('Gaming Hub')).toBeTruthy();
    expect(screen.getByText('Tech Talk')).toBeTruthy();
    expect(screen.getByText('42 members')).toBeTruthy();
  });

  it('clicking a category tab filters guilds', async () => {
    renderPage();
    expect(await screen.findByText('Gaming Hub')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId('category-tab-Gaming'));
    });

    await waitFor(() =>
      expect(api.discoverGuilds).toHaveBeenLastCalledWith(
        'tok-1',
        expect.objectContaining({ category: 'Gaming', page: 1 }),
        expect.any(String),
      ),
    );
  });

  it('clicking a guild card opens preview modal', async () => {
    renderPage();
    expect(await screen.findByText('Gaming Hub')).toBeTruthy();

    fireEvent.click(screen.getByTestId('guild-card-g1'));

    const modal = screen.getByTestId('guild-preview-modal');
    expect(modal).toBeTruthy();
    expect(modal.textContent).toContain('A place for gamers');
  });

  it('preview modal shows guild name and member count', async () => {
    renderPage();
    expect(await screen.findByText('Gaming Hub')).toBeTruthy();

    fireEvent.click(screen.getByTestId('guild-card-g1'));

    const modal = screen.getByTestId('guild-preview-modal');
    expect(modal.textContent).toContain('Gaming Hub');
    expect(modal.textContent).toContain('42 members');
  });

  it('join button calls joinGuildFromExplore for open guild', async () => {
    api.joinGuildFromExplore.mockResolvedValue({ status: 201, data: { id: 'g1' } });
    renderPage();
    expect(await screen.findByText('Gaming Hub')).toBeTruthy();

    fireEvent.click(screen.getByTestId('guild-card-g1'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('join-btn'));
    });

    expect(api.joinGuildFromExplore).toHaveBeenCalledWith('tok-1', 'g1', expect.any(String));
  });

  it('shows empty state when no guilds returned', async () => {
    api.discoverGuilds.mockResolvedValue({ guilds: [], total: 0, page: 1, pageSize: 20 });
    renderPage();
    expect(await screen.findByTestId('explore-empty')).toBeTruthy();
  });

  it('search input exists and accepts input', async () => {
    renderPage();
    expect(await screen.findByText('Gaming Hub')).toBeTruthy();

    const input = screen.getByPlaceholderText('Search servers...');
    fireEvent.change(input, { target: { value: 'test' } });
    expect(input.value).toBe('test');
  });
});
