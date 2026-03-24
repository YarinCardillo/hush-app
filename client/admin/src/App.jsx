import { useState, useCallback, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import GuildListPage from './pages/GuildListPage.jsx';
import UserListPage from './pages/UserListPage.jsx';
import ConfigPage from './pages/ConfigPage.jsx';
import HealthPage from './pages/HealthPage.jsx';

const STORAGE_KEY = 'hush_admin_api_key';

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
  keyBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  keyInput: {
    padding: '5px 10px',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text)',
    fontSize: '0.8rem',
    width: '220px',
    fontFamily: 'var(--font-mono)',
    outline: 'none',
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
};

function ApiKeyGate({ onKeySet }) {
  const [value, setValue] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const key = value.trim();
    if (key) onKeySet(key);
  };

  return (
    <div style={styles.gate}>
      <div style={styles.gateTitle}>Hush Instance Admin</div>
      <div style={styles.gateNote}>
        Enter the admin API key for this instance. The key is stored in session storage
        and cleared when you close the tab.
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
        <button type="submit" className="btn btn-primary" disabled={!value.trim()}>
          Authenticate
        </button>
      </form>
    </div>
  );
}

/** Inner app — rendered only when apiKey is set. */
function AdminShell({ apiKey, onKeyChange }) {
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
        <div style={styles.keyBox}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>API Key:</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => onKeyChange(e.target.value)}
            style={styles.keyInput}
            placeholder="X-Admin-Key"
            title="Admin API key — stored in session storage only"
          />
        </div>
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
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem(STORAGE_KEY) || '');

  const handleKeySet = useCallback((key) => {
    sessionStorage.setItem(STORAGE_KEY, key);
    setApiKey(key);
  }, []);

  const handleKeyChange = useCallback((key) => {
    sessionStorage.setItem(STORAGE_KEY, key);
    setApiKey(key);
  }, []);

  return (
    <BrowserRouter>
      {!apiKey ? (
        <ApiKeyGate onKeySet={handleKeySet} />
      ) : (
        <AdminShell apiKey={apiKey} onKeyChange={handleKeyChange} />
      )}
    </BrowserRouter>
  );
}
