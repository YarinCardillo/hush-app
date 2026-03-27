import { useState, useRef, useEffect } from 'react';
import { searchUsersForDM, createOrFindDM } from '../lib/api';

/**
 * Full-height DM conversation list with search.
 * Replaces the channel sidebar when DM mode is active.
 */
export default function DmListView({ dmGuilds, onSelectDm, getToken }) {
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(searchTimerRef.current), []);

  const handleSearchChange = (e) => {
    const q = e.target.value;
    setSearchQuery(q);
    clearTimeout(searchTimerRef.current);
    if (!q.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const token = getToken?.();
        if (!token) return;
        const results = await searchUsersForDM(token, q.trim());
        setSearchResults(Array.isArray(results) ? results : []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  const handleSelectUser = async (user) => {
    try {
      const token = getToken?.();
      if (!token) return;
      const dmGuild = await createOrFindDM(token, user.id);
      setShowSearch(false);
      setSearchQuery('');
      setSearchResults([]);
      onSelectDm?.(dmGuild);
    } catch (err) {
      console.error('[DmListView] createOrFindDM failed:', err);
    }
  };

  return (
    <div className="dm-list-view">
      <div className="dm-list-header">
        <span className="dm-list-title">Direct Messages</span>
        <button
          type="button"
          className="dm-list-new-btn"
          onClick={() => setShowSearch((v) => !v)}
          title="New message"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {showSearch && (
        <div className="dm-list-search">
          <input
            autoFocus
            type="text"
            placeholder="Find a user..."
            value={searchQuery}
            onChange={handleSearchChange}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setShowSearch(false);
                setSearchQuery('');
                setSearchResults([]);
              }
            }}
            className="dm-list-search-input"
          />
          {(searchResults.length > 0 || searching) && (
            <div className="dm-list-search-results">
              {searching && (
                <div className="dm-list-search-status">Searching...</div>
              )}
              {searchResults.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  className="dm-list-search-item"
                  onClick={() => handleSelectUser(user)}
                >
                  <div className="dm-list-avatar">
                    {(user.displayName || user.username || '?').charAt(0).toUpperCase()}
                  </div>
                  {user.displayName || user.username}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="dm-list-conversations">
        {dmGuilds.length === 0 ? (
          <div className="dm-list-empty">
            No conversations yet
          </div>
        ) : (
          dmGuilds.map((guild) => {
            const displayName = guild.otherUser?.displayName
              || guild.otherUser?.username
              || 'Direct Message';
            const initial = displayName.charAt(0).toUpperCase();
            const unread = guild.channels?.[0]?.unreadCount ?? 0;

            return (
              <button
                key={guild.id}
                type="button"
                className={`dm-list-item${unread > 0 ? ' dm-list-item--unread' : ''}`}
                onClick={() => onSelectDm?.(guild)}
              >
                <div className="dm-list-avatar">{initial}</div>
                <span className="dm-list-item-name">{displayName}</span>
                {unread > 0 && (
                  <span className="dm-list-item-badge">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
