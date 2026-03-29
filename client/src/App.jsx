import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { InstanceProvider, useInstanceContext } from './contexts/InstanceContext';
import { BootProvider, useBootController } from './hooks/useBootController.jsx';
import AppBackground from './components/AppBackground';
import { applyThemeMode, getStoredThemeMode } from './components/UserSettingsModal';
import { useSingleTab } from './hooks/useSingleTab';
import { slugify } from './lib/slugify';

// Apply stored theme before first paint to avoid FOUC.
applyThemeMode(getStoredThemeMode());

const Home = lazy(() => import('./pages/Home'));
const Invite = lazy(() => import('./pages/Invite'));
const LinkDevice = lazy(() => import('./pages/LinkDevice.jsx'));
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

// ── PostLoginRedirect ─────────────────────────────────────────────────────────

/**
 * Shown at "/" when the user is authenticated. Redirects to the first guild
 * (if any) or to /home (empty state). Handles ?join= invite params.
 *
 * This replaces the routing logic that was previously in Home.jsx's vault-state
 * effect. The BootController guarantees this only renders when auth is ready.
 */
function PostLoginRedirect() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { mergedGuilds, guildsLoaded } = useInstanceContext();
  const joinParam = searchParams.get('join');

  useEffect(() => {
    // Handle invite join param — redirect immediately, don't wait for guilds.
    if (joinParam) {
      navigate(`/invite/${encodeURIComponent(joinParam)}`, { replace: true });
      return;
    }

    // Wait for instance boot so mergedGuilds is populated.
    if (!guildsLoaded) return;

    // Navigate to first guild or empty state.
    if (mergedGuilds.length > 0) {
      const first = mergedGuilds[0];
      const instanceHost = first.instanceUrl
        ? new URL(first.instanceUrl).host
        : null;
      const guildSlug = slugify(first._localName ?? first.name ?? first.id ?? 'guild');
      if (instanceHost) {
        navigate(`/${instanceHost}/${guildSlug}`, { replace: true });
        return;
      }
    }

    navigate('/home', { replace: true });
  }, [guildsLoaded, mergedGuilds, navigate, joinParam]);

  return fallback;
}

// ── AppContent ────────────────────────────────────────────────────────────────

/**
 * Top-level rendering switch driven by useBootController.
 *
 * This is the single place that decides what the user sees. No other component
 * independently checks auth/vault/guild state for routing decisions.
 *
 * Boot states:
 *   'loading'     → blank screen (auth rehydrating)
 *   'needs_login' → Home (login/register UI) for all non-public routes
 *   'needs_pin'   → Home (PIN unlock screen) for all non-public routes
 *   'pin_setup'   → Home (PIN setup after registration) for all non-public routes
 *   'ready'       → full route tree (instances still booting)
 *   'booted'      → full route tree (everything loaded)
 */
function AppContent() {
  const { bootState } = useBootController();

  if (bootState === 'loading') return fallback;

  // ── Unauthenticated: show login/PIN for most routes, keep public routes ──

  if (bootState === 'needs_login' || bootState === 'needs_pin' || bootState === 'pin_setup') {
    return (
      <Suspense fallback={fallback}>
        <Routes>
          {/* Public routes — accessible without auth */}
          <Route path="/join/:instance/:code" element={<Invite />} />
          <Route path="/invite/:code" element={<Invite />} />
          <Route path="/link-device" element={<LinkDevice />} />
          <Route path="/room/:roomName" element={<Room />} />
          <Route path="/roadmap" element={<Roadmap />} />

          {/* Everything else → login/PIN screen */}
          <Route path="*" element={<Home />} />
        </Routes>
      </Suspense>
    );
  }

  // ── Authenticated (ready or booted): full route tree ─────────────────────

  return (
    <Suspense fallback={fallback}>
      <Routes>
        {/* Post-login redirect: "/" → first guild or /home */}
        <Route path="/" element={<PostLoginRedirect />} />

        {/* DM landing / no-guild empty state */}
        <Route path="/home" element={<ServerLayout />} />

        {/* Guild discovery */}
        <Route path="/explore" element={<ExplorePage />} />

        {/* Cross-instance invite */}
        <Route path="/join/:instance/:code" element={<Invite />} />

        {/* Same-instance invite (legacy path kept) */}
        <Route path="/invite/:code" element={<Invite />} />

        {/* Device-link approval/new-device handoff */}
        <Route path="/link-device" element={<LinkDevice />} />

        {/* Instance-aware guild route: /:instance/:guildSlug/:channelSlug? */}
        <Route path="/:instance/:guildSlug/:channelSlug?" element={<ServerLayout />} />

        {/* Legacy: /servers/:serverId/* */}
        <Route path="/servers/:serverId/*" element={<ServerLayout />} />

        {/* Legacy redirects */}
        <Route path="/guilds" element={<Navigate to="/home" replace />} />
        <Route path="/channels" element={<Navigate to="/home" replace />} />
        <Route path="/channels/:channelId" element={<Navigate to="/home" replace />} />

        {/* Utility pages */}
        <Route path="/room/:roomName" element={<Room />} />
        <Route path="/roadmap" element={<Roadmap />} />
      </Routes>
    </Suspense>
  );
}

// ── Cosmetic components ──────────────────────────────────────────────────────

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

// ── App root ─────────────────────────────────────────────────────────────────

export default function App() {
  const { isBlockedTab, takeOver } = useSingleTab();

  if (isBlockedTab) {
    return <BlockedTabOverlay takeOver={takeOver} />;
  }

  return (
    <AuthProvider>
      <InstanceProvider>
        <BootProvider>
          <FaviconThemeSync />
          <AppBackground />
          <AppContent />
        </BootProvider>
      </InstanceProvider>
    </AuthProvider>
  );
}
