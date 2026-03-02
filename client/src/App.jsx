import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import AppBackground from './components/AppBackground';
import { applyThemeMode, getStoredThemeMode } from './components/UserSettingsModal';

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


export default function App() {
  return (
    <AuthProvider>
      <FaviconThemeSync />
      <AppBackground />
      <Suspense fallback={fallback}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/invite/:code" element={<Invite />} />
          <Route path="/server" element={<ServerLayout />} />
          <Route path="/server/:serverId" element={<ServerLayout />} />
          <Route path="/server/:serverId/channel/:channelId" element={<ServerLayout />} />
          <Route path="/room/:roomName" element={<Room />} />
          <Route path="/roadmap" element={<Roadmap />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}
