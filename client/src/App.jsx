import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { InstanceProvider } from './contexts/InstanceContext';
import AppBackground from './components/AppBackground';
import { applyThemeMode, getStoredThemeMode } from './components/UserSettingsModal';
import { useSingleTab } from './hooks/useSingleTab';

// Apply stored theme before first paint to avoid FOUC.
applyThemeMode(getStoredThemeMode());

const Home = lazy(() => import('./pages/Home'));
const Invite = lazy(() => import('./pages/Invite'));
const Room = lazy(() => import('./pages/Room'));
const Roadmap = lazy(() => import('./pages/Roadmap'));
const ServerLayout = lazy(() => import('./pages/ServerLayout'));
const ExplorePage = lazy(() => import('./pages/ExplorePage'));

const fallback = (
  <div style={{
    height: '100%',
    background: 'var(--hush-black)',
  }} />
);

/**
 * Auth guard for protected routes. Redirects to "/" (Home/PIN screen)
 * when the user is unauthenticated or the vault is locked. Without this,
 * iOS page evictions leave the user on a guild URL with no auth context,
 * showing an empty layout instead of the PIN unlock screen.
 *
 * @param {{ children: React.ReactNode }} props
 */
function AuthGuard({ children }) {
  const { vaultState, isAuthenticated, loading } = useAuth();

  // While auth is rehydrating, show the same blank fallback to avoid flash.
  if (loading) return fallback;

  // Vault locked or no session — redirect to Home for PIN unlock or login.
  if (vaultState === 'locked' || vaultState === 'none' || !isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return children;
}

/** Syncs favicon and apple-touch-icon with theme (prefers-color-scheme or data-theme). */
function FaviconThemeSync() {
  useEffect(() => {
    const getTheme = () => {
      const dataTheme = document.documentElement.getAttribute('data-theme');
      if (dataTheme) return dataTheme;
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    };
    const apply = () => {
      const theme = getTheme();
      const favicon = document.getElementById('favicon');
      const appleTouch = document.getElementById('apple-touch-icon');
      if (favicon) favicon.href = theme === 'light' ? '/favicon-light.png' : '/favicon.png';
      if (appleTouch) appleTouch.href = theme === 'light' ? '/apple-touch-icon-light.png' : '/apple-touch-icon.png';
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', apply);
    return () => {
      mo.disconnect();
      mq.removeEventListener('change', apply);
    };
  }, []);
  return null;
}

/**
 * Full-screen overlay shown when the app detects it is open in a duplicate
 * browser tab. Prevents two tabs from sharing the same MLS/vault state.
 *
 * @param {{ takeOver: () => void }} props
 */
function BlockedTabOverlay({ takeOver }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--hush-black)',
        color: 'var(--hush-text)',
        textAlign: 'center',
        padding: '24px',
        zIndex: 9999,
      }}
    >
      <p style={{ fontSize: '1.1rem', marginBottom: '8px' }}>
        Hush is already open in another tab.
      </p>
      <p style={{ fontSize: '0.9rem', color: 'var(--hush-text-muted)', marginBottom: '24px' }}>
        Close the other tab or click below to use this one instead.
      </p>
      <button
        type="button"
        className="btn btn-primary"
        onClick={takeOver}
        style={{ padding: '10px 24px' }}
      >
        Use this one instead
      </button>
    </div>
  );
}

export default function App() {
  const { isBlockedTab, takeOver } = useSingleTab();

  if (isBlockedTab) {
    return <BlockedTabOverlay takeOver={takeOver} />;
  }

  return (
    <AuthProvider>
      <InstanceProvider>
        <FaviconThemeSync />
        <AppBackground />
        <Suspense fallback={fallback}>
          <Routes>
            {/* Auth / landing page */}
            <Route path="/" element={<Home />} />

            {/* DM landing / no-guild empty state */}
            <Route path="/home" element={<AuthGuard><ServerLayout /></AuthGuard>} />

            {/* Guild discovery */}
            <Route path="/explore" element={<AuthGuard><ExplorePage /></AuthGuard>} />

            {/* Cross-instance invite */}
            <Route path="/join/:instance/:code" element={<Invite />} />

            {/* Same-instance invite (legacy path kept) */}
            <Route path="/invite/:code" element={<Invite />} />

            {/* Instance-aware guild route: /:instance/:guildSlug/:channelSlug? */}
            <Route path="/:instance/:guildSlug/:channelSlug?" element={<AuthGuard><ServerLayout /></AuthGuard>} />

            {/* Legacy: /servers/:serverId/* — still works via ServerLayout legacy lookup */}
            <Route path="/servers/:serverId/*" element={<AuthGuard><ServerLayout /></AuthGuard>} />

            {/* Legacy: /guilds — redirect to /home */}
            <Route path="/guilds" element={<Navigate to="/home" replace />} />

            {/* Legacy single-tenant paths */}
            <Route path="/channels" element={<Navigate to="/home" replace />} />
            <Route path="/channels/:channelId" element={<Navigate to="/home" replace />} />

            {/* Utility pages */}
            <Route path="/room/:roomName" element={<Room />} />
            <Route path="/roadmap" element={<Roadmap />} />
          </Routes>
        </Suspense>
      </InstanceProvider>
    </AuthProvider>
  );
}
