/**
 * ExplorePage — guild discovery page with category tabs, search, cards, and join flow.
 *
 * Consumes GET /api/guilds/discover and POST /api/servers/:id/join from the backend.
 * Mounted at /explore behind AuthGuard.
 *
 * @module ExplorePage
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { discoverGuilds, joinGuildFromExplore } from '../lib/api';
import { useInstanceContext } from '../contexts/InstanceContext.jsx';

const CATEGORIES = [
  'All', 'Gaming', 'Technology', 'Music', 'Art', 'Education',
  'Science', 'Community', 'Sports', 'Entertainment', 'Other',
];

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 500;

export default function ExplorePage() {
  const { instanceStates, refreshGuilds, getTokenForInstance } = useInstanceContext();
  const navigate = useNavigate();

  const [guilds, setGuilds] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedGuild, setSelectedGuild] = useState(null);
  const [joining, setJoining] = useState(false);
  const [joinMessage, setJoinMessage] = useState('');

  const searchTimerRef = useRef(null);
  const debouncedSearch = useRef('');

  // Resolve first connected instance for token + baseUrl.
  const { token, baseUrl } = _resolveInstance(instanceStates, getTokenForInstance);

  const fetchGuilds = useCallback(async (params) => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await discoverGuilds(token, {
        category: params.category || undefined,
        search: params.search || undefined,
        sort: 'members',
        page: params.page,
        pageSize: PAGE_SIZE,
      }, baseUrl);
      setGuilds(res.guilds ?? []);
      setTotal(res.total ?? 0);
    } catch (err) {
      console.error('[ExplorePage] discoverGuilds failed:', err);
      setGuilds([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [token, baseUrl]);

  // Fetch on mount and when category/page changes.
  useEffect(() => {
    fetchGuilds({ category, search: debouncedSearch.current, page });
  }, [category, page, fetchGuilds]);

  // Debounced search effect.
  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearch(value);
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      debouncedSearch.current = value;
      setPage(1);
      fetchGuilds({ category, search: value, page: 1 });
    }, SEARCH_DEBOUNCE_MS);
  };

  useEffect(() => () => clearTimeout(searchTimerRef.current), []);

  const handleCategoryClick = (cat) => {
    const value = cat === 'All' ? '' : cat;
    setCategory(value);
    setPage(1);
  };

  const handleJoin = async (guild) => {
    if (!token || joining) return;
    setJoining(true);
    setJoinMessage('');
    try {
      const result = await joinGuildFromExplore(token, guild.id, baseUrl);
      if (result.status === 201 || result.status === 200) {
        await refreshGuilds(baseUrl).catch(() => {});
        setSelectedGuild(null);
        navigate('/home');
      } else if (result.status === 409) {
        setJoinMessage("You're already a member");
        setTimeout(() => {
          setSelectedGuild(null);
          navigate('/home');
        }, 1200);
      } else if (result.status === 202) {
        setJoinMessage('Request sent — you\'ll be notified when approved.');
        setTimeout(() => setSelectedGuild(null), 2000);
      }
    } catch (err) {
      console.error('[ExplorePage] join failed:', err);
      setJoinMessage('Failed to join server');
    } finally {
      setJoining(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="explore-root">
      <div className="explore-header">
        <h1 className="explore-title">Explore Servers</h1>
      </div>

      {/* Category tabs */}
      <div className="explore-tab-row">
        {CATEGORIES.map((cat) => {
          const active = (cat === 'All' && category === '') || cat === category;
          return (
            <button
              key={cat}
              type="button"
              data-testid={`category-tab-${cat}`}
              onClick={() => handleCategoryClick(cat)}
              className={`explore-tab${active ? ' explore-tab--active' : ''}`}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {/* Search bar */}
      <div className="explore-search-wrap">
        <input
          type="text"
          placeholder="Search servers..."
          value={search}
          onChange={handleSearchChange}
          className="explore-search-input"
        />
      </div>

      {/* Content */}
      {loading ? (
        <div className="explore-grid">
          {[0, 1, 2].map((i) => (
            <div key={i} className="explore-skeleton" data-testid="skeleton-card" />
          ))}
        </div>
      ) : guilds.length === 0 ? (
        <div className="explore-empty" data-testid="explore-empty">
          {search
            ? `No servers matching "${search}"`
            : category
              ? 'No servers in this category.'
              : 'No servers found'}
        </div>
      ) : (
        <>
          <div className="explore-grid">
            {guilds.map((guild) => (
              <button
                key={guild.id}
                type="button"
                data-testid={`guild-card-${guild.id}`}
                onClick={() => { setSelectedGuild(guild); setJoinMessage(''); }}
                className="explore-card"
              >
                <div className="explore-card-name">{guild.publicName}</div>
                <div className="explore-card-desc">
                  {_truncate(guild.publicDescription, 100)}
                </div>
                <div className="explore-card-meta">
                  <span>{guild.memberCount} members</span>
                  {guild.category && <span className="explore-category-badge">{guild.category}</span>}
                  <span className={guild.accessPolicy === 'open' ? 'explore-open-badge' : 'explore-request-badge'}>
                    {guild.accessPolicy === 'open' ? 'Open' : 'Request to join'}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="explore-pagination">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="explore-page-btn"
              >
                Previous
              </button>
              <span className="explore-page-info">Page {page} of {totalPages}</span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="explore-page-btn"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {/* Preview modal */}
      {selectedGuild && (
        <div
          className="explore-overlay"
          data-testid="guild-preview-modal"
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedGuild(null); }}
        >
          <div className="explore-modal">
            <button
              type="button"
              onClick={() => setSelectedGuild(null)}
              className="explore-modal-close"
              aria-label="Close"
            >
              X
            </button>
            <h2 className="explore-modal-name">{selectedGuild.publicName}</h2>
            <p className="explore-modal-desc">{selectedGuild.publicDescription}</p>
            <div className="explore-modal-meta">
              <span>{selectedGuild.memberCount} members</span>
              {selectedGuild.category && (
                <span className="explore-category-badge">{selectedGuild.category}</span>
              )}
            </div>
            {joinMessage ? (
              <div className="explore-join-message">{joinMessage}</div>
            ) : (
              <button
                type="button"
                data-testid="join-btn"
                onClick={() => handleJoin(selectedGuild)}
                disabled={joining}
                className={selectedGuild.accessPolicy === 'open' ? 'explore-join-btn-primary' : 'explore-join-btn-secondary'}
              >
                {joining
                  ? 'Joining...'
                  : selectedGuild.accessPolicy === 'open'
                    ? 'Join Server'
                    : 'Request to Join'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function _truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

function _resolveInstance(instanceStates, getTokenForInstance) {
  for (const [url, state] of instanceStates.entries()) {
    if (state.connectionState === 'connected') {
      const tok = getTokenForInstance?.(url) ?? state.token;
      return { token: tok, baseUrl: url === window.location.origin ? '' : url };
    }
  }
  // Fallback: first entry regardless of connection state.
  const first = instanceStates.entries().next().value;
  if (first) {
    const [url, state] = first;
    const tok = getTokenForInstance?.(url) ?? state.token;
    return { token: tok, baseUrl: url === window.location.origin ? '' : url };
  }
  return { token: null, baseUrl: '' };
}

