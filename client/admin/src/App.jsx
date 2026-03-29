import { useState, useCallback } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import GuildListPage from './pages/GuildListPage.jsx';
import UserListPage from './pages/UserListPage.jsx';
import ConfigPage from './pages/ConfigPage.jsx';
import HealthPage from './pages/HealthPage.jsx';

const ADMIN_HEALTH_URL = '/api/admin/health';

const styles = {
  shell: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '24px',
    padding: '0 24px',
    height: '52px',
    background: 'var(--surface)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  brand: {
    fontSize: '0.95rem',
    fontWeight: 700,
    color: 'var(--accent)',
    letterSpacing: '0.02em',
  },
  nav: {
    display: 'flex',
    gap: '4px',
    flex: 1,
  },
  navLink: {
    padding: '6px 12px',
    borderRadius: 'var(--radius-sm)',
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    fontWeight: 400,
    textDecoration: 'none',
    transition: 'color 0.12s ease, background 0.12s ease',
  },
  body: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  gate: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: '16px',
    padding: '40px',
  },
  gateTitle: {
    fontSize: '1.1rem',
    fontWeight: 600,
    color: 'var(--text)',
    marginBottom: '4px',
  },
  gateNote: {
    fontSize: '0.85rem',
    color: 'var(--text-muted)',
    maxWidth: '380px',
    textAlign: 'center',
    lineHeight: 1.6,
  },
  gateInput: {
    padding: '10px 14px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text)',
    fontSize: '0.9rem',
    width: '340px',
    fontFamily: 'var(--font-mono)',
    outline: 'none',
  },
  logoutBtn: {
    background: 'none',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    padding: '4px 12px',
    fontSize: '0.78rem',
    transition: 'color 0.12s ease, border-color 0.12s ease',
  },
};

function ApiKeyGate({ onKeySet }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [validating, setValidating] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const key = value.trim();
    if (!key) return;

    setError('');
    setValidating(true);
    try {
      const res = await fetch(ADMIN_HEALTH_URL, {
        headers: { 'X-Admin-Key': key },
      });
      if (res.status === 401 || res.status === 403) {
        setError('Invalid API key.');
        setValidating(false);
        return;
      }
      if (!res.ok) {
        setError(`Server error: ${res.status}`);
        setValidating(false);
        return;
      }
      onKeySet(key);
    } catch {
      setError('Could not reach the server.');
      setValidating(false);
    }
  };

  return (
    <div style={styles.gate}>
      <div style={styles.gateTitle}>Hush Instance Admin</div>
      <div style={styles.gateNote}>
        Enter the admin API key for this instance. The key is held in memory only
        and cleared on page refresh.
      </div>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' }}>
        <input
          type="password"
          placeholder="X-Admin-Key value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={styles.gateInput}
          autoFocus
        />
        {error && <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={!value.trim() || validating}>
          {validating ? 'Verifying...' : 'Authenticate'}
        </button>
      </form>
    </div>
  );
}

function AdminShell({ apiKey, onLogout }) {
  const navActive = ({ isActive }) => ({
    ...styles.navLink,
    ...(isActive ? { color: 'var(--text)', background: 'var(--elevated)', fontWeight: 500 } : {}),
  });

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <span style={styles.brand}>Hush Admin</span>
        <nav style={styles.nav}>
          <NavLink to="/guilds" style={navActive}>Guilds</NavLink>
          <NavLink to="/users" style={navActive}>Users</NavLink>
          <NavLink to="/config" style={navActive}>Config</NavLink>
          <NavLink to="/health" style={navActive}>Health</NavLink>
        </nav>
        <button type="button" style={styles.logoutBtn} onClick={onLogout}>
          Logout
        </button>
      </header>
      <div style={styles.body}>
        <Routes>
          <Route path="/" element={<Navigate to="/guilds" replace />} />
          <Route path="/guilds" element={<GuildListPage apiKey={apiKey} />} />
          <Route path="/users" element={<UserListPage apiKey={apiKey} />} />
          <Route path="/config" element={<ConfigPage apiKey={apiKey} />} />
          <Route path="/health" element={<HealthPage apiKey={apiKey} />} />
        </Routes>
      </div>
    </div>
  );
}

export default function App() {
  const [apiKey, setApiKey] = useState('');

  const handleKeySet = useCallback((key) => {
    setApiKey(key);
  }, []);

  const handleLogout = useCallback(() => {
    setApiKey('');
  }, []);

  return (
    <BrowserRouter basename="/admin">
      {!apiKey ? (
        <ApiKeyGate onKeySet={handleKeySet} />
      ) : (
        <AdminShell apiKey={apiKey} onLogout={handleLogout} />
      )}
    </BrowserRouter>
  );
}
