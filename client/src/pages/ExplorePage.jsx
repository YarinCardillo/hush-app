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
    <div style={styles.root}>
      <div style={styles.header}>
        <h1 style={styles.title}>Explore Servers</h1>
      </div>

      {/* Category tabs */}
      <div style={styles.tabRow}>
        {CATEGORIES.map((cat) => {
          const active = (cat === 'All' && category === '') || cat === category;
          return (
            <button
              key={cat}
              type="button"
              data-testid={`category-tab-${cat}`}
              onClick={() => handleCategoryClick(cat)}
              style={active ? { ...styles.tab, ...styles.tabActive } : styles.tab}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {/* Search bar */}
      <div style={styles.searchWrap}>
        <input
          type="text"
          placeholder="Search servers..."
          value={search}
          onChange={handleSearchChange}
          style={styles.searchInput}
        />
      </div>

      {/* Content */}
      {loading ? (
        <div style={styles.grid}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={styles.skeleton} data-testid="skeleton-card" />
          ))}
        </div>
      ) : guilds.length === 0 ? (
        <div style={styles.emptyState} data-testid="explore-empty">
          {search
            ? `No servers matching "${search}"`
            : category
              ? 'No servers in this category.'
              : 'No servers found'}
        </div>
      ) : (
        <>
          <div style={styles.grid}>
            {guilds.map((guild) => (
              <button
                key={guild.id}
                type="button"
                data-testid={`guild-card-${guild.id}`}
                onClick={() => { setSelectedGuild(guild); setJoinMessage(''); }}
                style={styles.card}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--hush-border-hover)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--hush-border)';
                  e.currentTarget.style.transform = 'none';
                }}
              >
                <div style={styles.cardName}>{guild.publicName}</div>
                <div style={styles.cardDesc}>
                  {_truncate(guild.publicDescription, 100)}
                </div>
                <div style={styles.cardMeta}>
                  <span>{guild.memberCount} members</span>
                  {guild.category && <span style={styles.categoryBadge}>{guild.category}</span>}
                  <span style={guild.accessPolicy === 'open' ? styles.openBadge : styles.requestBadge}>
                    {guild.accessPolicy === 'open' ? 'Open' : 'Request to join'}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={styles.pagination}>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                style={styles.pageBtn}
              >
                Previous
              </button>
              <span style={styles.pageInfo}>Page {page} of {totalPages}</span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                style={styles.pageBtn}
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
          style={styles.overlay}
          data-testid="guild-preview-modal"
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedGuild(null); }}
        >
          <div style={styles.modal}>
            <button
              type="button"
              onClick={() => setSelectedGuild(null)}
              style={styles.closeBtn}
              aria-label="Close"
            >
              X
            </button>
            <h2 style={styles.modalName}>{selectedGuild.publicName}</h2>
            <p style={styles.modalDesc}>{selectedGuild.publicDescription}</p>
            <div style={styles.modalMeta}>
              <span>{selectedGuild.memberCount} members</span>
              {selectedGuild.category && (
                <span style={styles.categoryBadge}>{selectedGuild.category}</span>
              )}
            </div>
            {joinMessage ? (
              <div style={styles.joinMessage}>{joinMessage}</div>
            ) : (
              <button
                type="button"
                data-testid="join-btn"
                onClick={() => handleJoin(selectedGuild)}
                disabled={joining}
                style={selectedGuild.accessPolicy === 'open' ? styles.joinBtnPrimary : styles.joinBtnSecondary}
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

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  root: {
    height: '100%',
    overflowY: 'auto',
    background: 'var(--hush-black)',
    padding: '24px',
    fontFamily: 'var(--font-sans)',
  },
  header: {
    marginBottom: '16px',
  },
  title: {
    fontSize: '1.4rem',
    fontWeight: 300,
    color: 'var(--hush-text)',
    letterSpacing: '-0.02em',
    margin: 0,
  },
  tabRow: {
    display: 'flex',
    gap: '4px',
    overflowX: 'auto',
    marginBottom: '16px',
    paddingBottom: '4px',
  },
  tab: {
    padding: '6px 14px',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: 'var(--hush-text-muted)',
    cursor: 'pointer',
    fontSize: '0.8rem',
    fontFamily: 'var(--font-sans)',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  tabActive: {
    color: 'var(--hush-amber)',
    borderBottomColor: 'var(--hush-amber)',
  },
  searchWrap: {
    marginBottom: '20px',
  },
  searchInput: {
    width: '100%',
    maxWidth: '400px',
    padding: '8px 12px',
    background: 'var(--hush-surface)',
    border: '1px solid var(--hush-border)',
    color: 'var(--hush-text)',
    fontSize: '0.85rem',
    fontFamily: 'var(--font-sans)',
    outline: 'none',
    boxSizing: 'border-box',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '16px',
    marginBottom: '24px',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '16px',
    background: 'var(--hush-surface)',
    border: '1px solid var(--hush-border)',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'transform 0.15s ease, border-color 0.15s ease',
    fontFamily: 'var(--font-sans)',
  },
  cardName: {
    fontSize: '1rem',
    fontWeight: 500,
    color: 'var(--hush-text)',
  },
  cardDesc: {
    fontSize: '0.8rem',
    color: 'var(--hush-text-secondary)',
    lineHeight: 1.5,
  },
  cardMeta: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    fontSize: '0.75rem',
    color: 'var(--hush-text-muted)',
    flexWrap: 'wrap',
  },
  categoryBadge: {
    padding: '2px 8px',
    background: 'var(--hush-elevated)',
    color: 'var(--hush-text-secondary)',
    fontSize: '0.7rem',
  },
  openBadge: {
    padding: '2px 8px',
    background: 'rgba(52, 211, 153, 0.15)',
    color: 'var(--hush-live)',
    fontSize: '0.7rem',
  },
  requestBadge: {
    padding: '2px 8px',
    background: 'var(--hush-amber-ghost)',
    color: 'var(--hush-amber)',
    fontSize: '0.7rem',
  },
  skeleton: {
    height: '120px',
    background: 'var(--hush-surface)',
    border: '1px solid var(--hush-border)',
    animation: 'pulse 1.5s ease-in-out infinite',
  },
  emptyState: {
    textAlign: 'center',
    padding: '48px 24px',
    color: 'var(--hush-text-muted)',
    fontSize: '0.9rem',
  },
  pagination: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
  },
  pageBtn: {
    padding: '6px 14px',
    background: 'var(--hush-surface)',
    border: '1px solid var(--hush-border)',
    color: 'var(--hush-text)',
    cursor: 'pointer',
    fontSize: '0.8rem',
    fontFamily: 'var(--font-sans)',
  },
  pageInfo: {
    color: 'var(--hush-text-muted)',
    fontSize: '0.8rem',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: 'var(--hush-surface)',
    border: '1px solid var(--hush-border)',
    padding: '24px',
    maxWidth: '480px',
    width: '90%',
    position: 'relative',
  },
  closeBtn: {
    position: 'absolute',
    top: '12px',
    right: '12px',
    background: 'transparent',
    border: 'none',
    color: 'var(--hush-text-muted)',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontFamily: 'var(--font-sans)',
  },
  modalName: {
    fontSize: '1.2rem',
    fontWeight: 500,
    color: 'var(--hush-text)',
    margin: '0 0 8px',
  },
  modalDesc: {
    fontSize: '0.85rem',
    color: 'var(--hush-text-secondary)',
    lineHeight: 1.6,
    margin: '0 0 12px',
  },
  modalMeta: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    fontSize: '0.8rem',
    color: 'var(--hush-text-muted)',
    marginBottom: '16px',
  },
  joinBtnPrimary: {
    width: '100%',
    padding: '10px',
    background: 'var(--hush-amber)',
    color: 'var(--hush-black)',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: 500,
    fontFamily: 'var(--font-sans)',
  },
  joinBtnSecondary: {
    width: '100%',
    padding: '10px',
    background: 'var(--hush-elevated)',
    color: 'var(--hush-text)',
    border: '1px solid var(--hush-border)',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: 500,
    fontFamily: 'var(--font-sans)',
  },
  joinMessage: {
    textAlign: 'center',
    padding: '10px',
    color: 'var(--hush-text-secondary)',
    fontSize: '0.85rem',
  },
};
