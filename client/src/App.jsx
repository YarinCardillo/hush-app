import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import AppBackground from './components/AppBackground';
import { clearStoredCredentials, GUEST_SESSION_KEY } from './lib/authStorage';

const Home = lazy(() => import('./pages/Home'));
const Room = lazy(() => import('./pages/Room'));
const Roadmap = lazy(() => import('./pages/Roadmap'));

const fallback = (
  <div style={{
    height: '100%',
    background: 'var(--hush-black)',
  }} />
);

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

export default function App() {
  return (
    <AuthProvider>
      <GuestSessionCleanup />
      <AppBackground />
      <Suspense fallback={fallback}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/room/:roomName" element={<Room />} />
          <Route path="/roadmap" element={<Roadmap />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}
