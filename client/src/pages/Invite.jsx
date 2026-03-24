import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getInviteInfo, claimInvite } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useInstanceContext } from '../contexts/InstanceContext';
import { slugify } from '../lib/slugify';
import { decodeGuildNameFromInvite } from '../lib/guildMetadata';

const styles = {
  page: {
    minHeight: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    fontFamily: 'var(--font-sans)',
  },
  card: {
    padding: '24px',
    maxWidth: '400px',
    width: '100%',
  },
  title: {
    fontSize: '1rem',
    fontWeight: 500,
    color: 'var(--hush-text-secondary)',
    marginBottom: '8px',
  },
  guildName: {
    fontSize: '1.4rem',
    fontWeight: 300,
    color: 'var(--hush-text)',
    marginBottom: '8px',
    letterSpacing: '-0.02em',
  },
  instanceHost: {
    fontSize: '0.8rem',
    color: 'var(--hush-text-muted)',
    marginBottom: '24px',
    fontFamily: 'var(--font-mono)',
  },
  memberCount: {
    fontSize: '0.85rem',
    color: 'var(--hush-text-muted)',
    marginBottom: '24px',
  },
  error: {
    padding: '10px 14px',
    background: 'var(--hush-danger-ghost)',
    color: 'var(--hush-danger)',
    fontSize: '0.85rem',
    marginBottom: '16px',
    overflowWrap: 'break-word',
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  link: {
    color: 'var(--hush-amber-dim)',
    textDecoration: 'none',
    fontSize: '0.9rem',
  },
};

function inviteErrorMessage(err) {
  const msg = err?.message || '';
  if (/not found|expired|no longer valid/i.test(msg)) return 'Invite not found or expired.';
  if (/already.*member|409/i.test(msg)) return 'You are already a member.';
  if (/banned/i.test(msg)) return 'You are banned from this guild.';
  if (/invalid|expired|400/i.test(msg)) return 'Invite is invalid or expired.';
  return msg || 'Something went wrong.';
}

/**
 * Invite page — handles two URL patterns:
 *
 * 1. /invite/:code                   — same-instance invite (legacy)
 * 2. /join/:instance/:code           — cross-instance invite (new)
 *
 * Cross-instance flow:
 *   - Show confirm modal with guild name + instance host
 *   - On confirm: bootInstance(instanceUrl) -> claimInvite -> navigate to guild
 *
 * Same-instance flow:
 *   - Authenticated: auto-claim invite -> navigate to guild
 *   - Unauthenticated: show auth prompt (redirect to home)
 *
 * Vault locked: invite URL is queued in sessionStorage and processed after unlock.
 */
export default function Invite() {
  const { code, instance: instanceParam } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { bootInstance, getTokenForInstance, instanceStates, mergedGuilds } = useInstanceContext();

  /** Whether this is a cross-instance invite. */
  const isCrossInstance = Boolean(instanceParam);

  /** Canonical base URL for the remote instance (cross-instance only). */
  const instanceUrl = useMemo(() => {
    if (!instanceParam) return null;
    return `https://${instanceParam}`;
  }, [instanceParam]);

  const [invite, setInvite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [joining, setJoining] = useState(false);
  const [booting, setBooting] = useState(false);

  // Guild name from URL fragment (#name=...) — server never receives it.
  const guildNameFromFragment = useMemo(() => {
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    const encoded = params.get('name');
    return encoded ? decodeGuildNameFromInvite(encoded) : null;
  }, []);

  const guildName = guildNameFromFragment ?? 'a server';

  // ── Invite info fetch ──────────────────────────────────────────────────

  useEffect(() => {
    if (!code) {
      setLoading(false);
      setError('Invalid invite link.');
      return;
    }
    let cancelled = false;
    const baseUrl = instanceUrl ?? undefined;
    getInviteInfo(code, baseUrl)
      .then((data) => {
        if (!cancelled) {
          setInvite(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setInvite(null);
          setError(inviteErrorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [code, instanceUrl]);

  // ── Queue invite URL when vault is locked ─────────────────────────────

  useEffect(() => {
    if (!isAuthenticated) {
      // Store invite URL so Home.jsx can redirect back after authentication.
      sessionStorage.setItem('hush_pending_invite', window.location.href);
    }
  }, [isAuthenticated]);

  // ── Same-instance authenticated flow: auto-claim ──────────────────────

  useEffect(() => {
    if (isCrossInstance) return; // handled separately
    if (!isAuthenticated || !invite || !code) return;

    // Get token from the first (only) connected instance.
    const firstEntry = [...instanceStates.values()][0];
    const token = firstEntry?.jwt ?? null;
    if (!token) return;
    const firstInstanceUrl = [...instanceStates.keys()][0] ?? undefined;

    setJoining(true);
    claimInvite(token, code, firstInstanceUrl)
      .then((result) => {
        const serverId = result?.serverId ?? invite?.serverId;
        if (serverId) {
          const guild = mergedGuilds.find((g) => g.id === serverId);
          if (guild?.instanceUrl) {
            const host = (() => {
              try { return new URL(guild.instanceUrl).host; } catch { return null; }
            })();
            const slug = slugify(guild._localName ?? guild.name ?? serverId);
            if (host) {
              navigate(`/${host}/${slug}`, { replace: true });
              return;
            }
          }
          navigate(`/servers/${serverId}/channels`, { replace: true });
        } else {
          navigate('/home', { replace: true });
        }
      })
      .catch((err) => {
        setError(inviteErrorMessage(err));
        setJoining(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, invite, code, isCrossInstance]);

  // ── Cross-instance: user pressed "Join" ──────────────────────────────

  const handleCrossInstanceJoin = useCallback(async () => {
    if (!instanceUrl || !code) return;
    setError(null);
    setBooting(true);

    try {
      // Step 1: Boot the remote instance (handshake -> auth -> WS -> guild fetch).
      await bootInstance(instanceUrl);

      // Step 2: Get the JWT for the now-connected instance.
      const jwt = getTokenForInstance(instanceUrl);
      if (!jwt) throw new Error('Authentication failed for instance.');

      // Step 3: Claim the invite on the remote instance.
      setJoining(true);
      const result = await claimInvite(jwt, code, instanceUrl);
      const serverId = result?.serverId ?? invite?.serverId;

      // Step 4: Navigate to the guild using instance-aware URL.
      if (serverId) {
        const slug = slugify(guildName);
        navigate(`/${instanceParam}/${slug}`, { replace: true });
      } else {
        navigate(`/${instanceParam}`, { replace: true });
      }
    } catch (err) {
      setError(inviteErrorMessage(err));
    } finally {
      setBooting(false);
      setJoining(false);
    }
  }, [instanceUrl, code, bootInstance, getTokenForInstance, invite, guildName, instanceParam, navigate]);

  // ── Unauthenticated flow: redirect to / with pending invite queued ────

  const handleUnauthenticated = useCallback(() => {
    sessionStorage.setItem('hush_pending_invite', window.location.href);
    navigate('/', { replace: true });
  }, [navigate]);

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={styles.page}>
        <div className="glass" style={styles.card}>
          <p style={{ color: 'var(--hush-text-muted)', fontSize: '0.9rem' }}>Loading invite…</p>
        </div>
      </div>
    );
  }

  if (error && !invite) {
    return (
      <div style={styles.page}>
        <div className="glass" style={styles.card}>
          <p style={styles.error}>{error}</p>
          <a href="/" style={styles.link}>Return to home</a>
        </div>
      </div>
    );
  }

  if (!invite) return null;

  // ── Cross-instance invite UI ──────────────────────────────────────────

  if (isCrossInstance) {
    const memberCount = invite.memberCount ?? invite.member_count ?? null;
    const isConnecting = booting || joining;

    return (
      <div style={styles.page}>
        <div className="glass" style={styles.card}>
          <p style={styles.title}>You're invited to join</p>
          <p style={styles.guildName}>{guildName}</p>
          <p style={styles.instanceHost}>hosted on {instanceParam}</p>
          {memberCount != null && (
            <p style={styles.memberCount}>{memberCount} member{memberCount !== 1 ? 's' : ''}</p>
          )}
          {error && <p style={styles.error}>{error}</p>}
          {!isAuthenticated ? (
            <div style={styles.actions}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleUnauthenticated}
                style={{ padding: '12px' }}
              >
                Sign in to join
              </button>
              <a href="/" style={styles.link}>Return to home</a>
            </div>
          ) : (
            <div style={styles.actions}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCrossInstanceJoin}
                disabled={isConnecting}
                style={{ padding: '12px' }}
              >
                {booting ? 'Connecting to instance…' : joining ? 'Joining…' : 'Join'}
              </button>
              <a href="/" style={styles.link}>Return to home</a>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Same-instance invite UI ───────────────────────────────────────────

  if (isAuthenticated) {
    return (
      <div style={styles.page}>
        <div className="glass" style={styles.card}>
          <p style={styles.title}>You're invited to join</p>
          <p style={styles.guildName}>{guildName}</p>
          {error && <p style={styles.error}>{error}</p>}
          {!error && (
            <p style={{ color: 'var(--hush-text-muted)', fontSize: '0.9rem' }}>Joining…</p>
          )}
          {error && (
            <div style={styles.actions}>
              <a href="/" style={styles.link}>Return to home</a>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Unauthenticated same-instance: redirect to home with invite queued.
  return (
    <div style={styles.page}>
      <div className="glass" style={styles.card}>
        <p style={styles.title}>You're invited to join</p>
        <p style={styles.guildName}>{guildName}</p>
        {error && <p style={styles.error}>{error}</p>}
        <div style={styles.actions}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleUnauthenticated}
            style={{ padding: '12px' }}
          >
            Sign in to join
          </button>
          <a href="/" style={styles.link}>Return to home</a>
        </div>
      </div>
    </div>
  );
}
