import { useState, useEffect, useCallback } from 'react';
import { listGuilds } from '../lib/adminApi.js';

/**
 * GuildListPage — shows guild infrastructure metrics.
 * Displays UUIDs and counts only. No guild names (blind relay boundary).
 */

const PAGE_STYLES = {
  container: {
    padding: '24px 28px',
    overflowY: 'auto',
    height: '100%',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '20px',
  },
  title: {
    fontSize: '1.1rem',
    fontWeight: 600,
    color: 'var(--text)',
  },
  count: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    marginTop: '2px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.82rem',
  },
  th: {
    textAlign: 'left',
    padding: '8px 12px',
    color: 'var(--text-muted)',
    fontWeight: 600,
    fontSize: '0.72rem',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    borderBottom: '1px solid var(--border)',
    background: 'var(--surface)',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '10px 12px',
    borderBottom: '1px solid var(--border)',
    color: 'var(--text-secondary)',
    verticalAlign: 'middle',
  },
  tdMono: {
    padding: '10px 12px',
    borderBottom: '1px solid var(--border)',
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.78rem',
    verticalAlign: 'middle',
  },
  copyBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    padding: '2px 4px',
    fontSize: '0.75rem',
    transition: 'color 0.12s ease',
    marginLeft: '4px',
  },
  badge: (color) => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '3px',
    fontSize: '0.72rem',
    fontWeight: 500,
    background: color === 'green' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(255,255,255,0.06)',
    color: color === 'green' ? 'var(--success)' : 'var(--text-muted)',
  }),
  empty: {
    textAlign: 'center',
    padding: '60px 0',
    color: 'var(--text-muted)',
    fontSize: '0.9rem',
  },
  error: {
    padding: '16px',
    borderRadius: 'var(--radius-md)',
    background: 'rgba(239, 68, 68, 0.08)',
    border: '1px solid rgba(239, 68, 68, 0.2)',
    color: 'var(--danger)',
    fontSize: '0.85rem',
    marginBottom: '16px',
  },
};

const COLUMNS = [
  { key: 'id', label: 'Guild ID' },
  { key: 'memberCount', label: 'Members', numeric: true },
  { key: 'messageCount', label: 'Messages', numeric: true },
  { key: 'activeMembers30d', label: 'Active (30d)', numeric: true },
  { key: 'storageBytes', label: 'Storage', numeric: true },
  { key: 'accessPolicy', label: 'Access' },
  { key: 'discoverable', label: 'Discoverable' },
  { key: 'createdAt', label: 'Created' },
];

function formatBytes(bytes) {
  if (bytes == null) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function SortIndicator({ active, dir }) {
  if (!active) return <span style={{ marginLeft: '4px', opacity: 0.3 }}>⇅</span>;
  return <span style={{ marginLeft: '4px' }}>{dir === 'asc' ? '↑' : '↓'}</span>;
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <button type="button" style={PAGE_STYLES.copyBtn} onClick={handleCopy} title="Copy full UUID">
      {copied ? '✓' : '⧉'}
    </button>
  );
}

export default function GuildListPage({ apiKey }) {
  const [guilds, setGuilds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState('createdAt');
  const [sortDir, setSortDir] = useState('desc');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listGuilds(apiKey);
      setGuilds(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [apiKey]);

  useEffect(() => { load(); }, [load]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sorted = [...guilds].sort((a, b) => {
    let av = a[sortKey];
    let bv = b[sortKey];
    if (sortKey === 'createdAt') {
      av = av ? new Date(av).getTime() : 0;
      bv = bv ? new Date(bv).getTime() : 0;
    }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  return (
    <div style={PAGE_STYLES.container}>
      <div style={PAGE_STYLES.header}>
        <div>
          <div style={PAGE_STYLES.title}>Guilds</div>
          {!loading && (
            <div style={PAGE_STYLES.count}>{guilds.length} guild{guilds.length !== 1 ? 's' : ''}</div>
          )}
        </div>
        <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && <div style={PAGE_STYLES.error}>{error}</div>}

      {!loading && guilds.length === 0 && !error && (
        <div style={PAGE_STYLES.empty}>No guilds found on this instance.</div>
      )}

      {(guilds.length > 0 || loading) && (
        <table style={PAGE_STYLES.table}>
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  style={PAGE_STYLES.th}
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}
                  <SortIndicator active={sortKey === col.key} dir={sortDir} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((g) => (
              <tr key={g.id}>
                <td style={PAGE_STYLES.tdMono}>
                  {g.id ? `${g.id.slice(0, 8)}...` : '—'}
                  {g.id && <CopyButton text={g.id} />}
                </td>
                <td style={PAGE_STYLES.td}>{g.memberCount ?? '—'}</td>
                <td style={PAGE_STYLES.td}>{g.messageCount ?? '—'}</td>
                <td style={PAGE_STYLES.td}>{g.activeMembers30d ?? '—'}</td>
                <td style={PAGE_STYLES.td}>{formatBytes(g.storageBytes)}</td>
                <td style={PAGE_STYLES.td}>
                  {g.accessPolicy ? (
                    <span style={PAGE_STYLES.badge(g.accessPolicy === 'public' ? 'green' : 'neutral')}>
                      {g.accessPolicy}
                    </span>
                  ) : '—'}
                </td>
                <td style={PAGE_STYLES.td}>
                  {g.discoverable != null ? (
                    <span style={PAGE_STYLES.badge(g.discoverable ? 'green' : 'neutral')}>
                      {g.discoverable ? 'yes' : 'no'}
                    </span>
                  ) : '—'}
                </td>
                <td style={PAGE_STYLES.td}>{formatDate(g.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
