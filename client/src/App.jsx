import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import AppBackground from './components/AppBackground';
import { applyThemeMode, getStoredThemeMode } from './components/UserSettingsModal';
import { getMyGuilds } from './lib/api';
import { JWT_KEY } from './hooks/useAuth';

// Apply stored theme before first paint to avoid FOUC.
applyThemeMode(getStoredThemeMode());

const Home = lazy(() => import('./pages/Home'));
const Invite = lazy(() => import('./pages/Invite'));
const Room = lazy(() => import('./pages/Room'));
const Roadmap = lazy(() => import('./pages/Roadmap'));
const ServerLayout = lazy(() => import('./pages/ServerLayout'));

const fallback = (
  <div style={{
    height: '100%',
    background: 'var(--hush-black)',
  }} />
);

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

function getToken() {
  return typeof window !== 'undefined'
    ? (sessionStorage.getItem(JWT_KEY) ?? sessionStorage.getItem('hush_token'))
    : null;
}

/**
 * Home route handler: if authenticated, redirect to first guild or show empty-state page.
 * If unauthenticated, show the normal Home (login/register) page.
 */
function HomeRoute() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) {
      setChecking(false);
      return;
    }
    const token = getToken();
    if (!token) {
      setChecking(false);
      return;
    }
    getMyGuilds(token)
      .then((guilds) => {
        if (Array.isArray(guilds) && guilds.length > 0) {
          navigate(`/servers/${guilds[0].id}/channels`, { replace: true });
        } else {
          setChecking(false);
        }
      })
      .catch(() => setChecking(false));
  }, [isAuthenticated, navigate]);

  if (checking && isAuthenticated) {
    return <div style={{ height: '100%', background: 'var(--hush-black)' }} />;
  }

  if (isAuthenticated && !checking) {
    // No guilds — show empty state using ServerLayout without a serverId
    return <Navigate to="/guilds" replace />;
  }

  return (
    <Suspense fallback={fallback}>
      <Home />
    </Suspense>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <FaviconThemeSync />
      <AppBackground />
      <Suspense fallback={fallback}>
        <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/guilds" element={<ServerLayout />} />
          <Route path="/invite/:code" element={<Invite />} />
          <Route path="/servers/:serverId/*" element={<ServerLayout />} />
          <Route path="/room/:roomName" element={<Room />} />
          <Route path="/roadmap" element={<Roadmap />} />
          {/* Legacy redirect: single-tenant paths redirect to root */}
          <Route path="/channels" element={<Navigate to="/" replace />} />
          <Route path="/channels/:channelId" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}
