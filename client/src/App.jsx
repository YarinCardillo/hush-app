import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import AppBackground from './components/AppBackground';
import { clearStoredCredentials, GUEST_SESSION_KEY } from './lib/authStorage';

const Home = lazy(() => import('./pages/Home'));
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
      if (dataTheme === 'light' || dataTheme === 'dark') return dataTheme;
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

/** Clears guest session and credentials on tab close so guest is truly one-off. */
function GuestSessionCleanup() {
  useEffect(() => {
    const handler = () => {
      if (sessionStorage.getItem(GUEST_SESSION_KEY) === '1') {
        clearStoredCredentials();
        sessionStorage.removeItem(GUEST_SESSION_KEY);
      }
    };
    window.addEventListener('pagehide', handler);
    return () => window.removeEventListener('pagehide', handler);
  }, []);
  return null;
}

/**
 * Handles redirect from Matrix SSO: reads loginToken from query, exchanges it for
 * session, then redirects to / (or shows error and link to /).
 */
function LoginCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { completeSsoLogin, error: authError } = useAuth();
  const loginToken = searchParams.get('loginToken');

  useEffect(() => {
    if (!loginToken) {
      navigate('/', { replace: true });
      return;
    }
    let cancelled = false;
    completeSsoLogin(loginToken).then((ok) => {
      if (cancelled) return;
      if (ok) navigate('/', { replace: true });
    });
    return () => { cancelled = true; };
  }, [loginToken, completeSsoLogin, navigate]);

  if (!loginToken) {
    return null;
  }
  if (authError) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--hush-black)',
        color: 'var(--hush-text)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        padding: '24px',
        fontFamily: 'var(--font-sans)',
      }}>
        <p style={{ color: 'var(--hush-text-secondary)' }}>
          Sign-in failed: {authError?.message || 'Unknown error'}
        </p>
        <a href="/" style={{ color: 'var(--hush-amber-dim)' }}>Return to home</a>
      </div>
    );
  }
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--hush-black)',
      color: 'var(--hush-text-secondary)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-sans)',
    }}>
      Signing you in…
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <FaviconThemeSync />
      <GuestSessionCleanup />
      <AppBackground />
      <Suspense fallback={fallback}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login/callback" element={<LoginCallback />} />
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
