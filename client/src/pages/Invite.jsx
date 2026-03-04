import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getInviteInfo, claimInvite } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

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
    marginBottom: '24px',
    letterSpacing: '-0.02em',
  },
  error: {
    padding: '10px 14px',
    background: 'var(--hush-danger-ghost)',
    color: 'var(--hush-danger)',
    fontSize: '0.85rem',
    marginBottom: '16px',
    overflowWrap: 'break-word',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginBottom: '16px',
  },
  fieldLabel: {
    display: 'block',
    fontSize: '0.8rem',
    fontWeight: 500,
    color: 'var(--hush-text-secondary)',
    marginBottom: '6px',
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
 * Two-phase guild invite page:
 * - Unauthenticated: shows register form, then claims invite after registration.
 * - Authenticated: auto-claims the invite and navigates to /servers/${serverId}/channels.
 *
 * serverId comes from two sources:
 * 1. getInviteInfo response (before claim) — available immediately after page load
 * 2. claimInvite response — used to navigate after successful claim
 */
export default function Invite() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { token, isAuthenticated, register: authRegister } = useAuth();

  const [invite, setInvite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Registration form state (unauthenticated flow)
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [registerLoading, setRegisterLoading] = useState(false);

  // Fetch invite info on mount (public endpoint)
  useEffect(() => {
    if (!code) {
      setLoading(false);
      setError('Invalid invite link.');
      return;
    }
    let cancelled = false;
    getInviteInfo(code)
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
  }, [code]);

  // Authenticated flow: auto-claim invite and navigate to the guild
  useEffect(() => {
    if (!isAuthenticated || !token || !invite || !code) return;
    claimInvite(token, code)
      .then((result) => {
        const serverId = result?.serverId ?? invite?.serverId;
        if (serverId) {
          navigate(`/servers/${serverId}/channels`, { replace: true });
        } else {
          navigate('/', { replace: true });
        }
      })
      .catch((err) => setError(inviteErrorMessage(err)));
  }, [isAuthenticated, token, invite, code, navigate]);

  const handleRegisterAndClaim = useCallback(async (e) => {
    e.preventDefault();
    setError(null);

    const trimmedUsername = username.trim();
    const trimmedDisplayName = displayName.trim();
    if (!trimmedUsername || !password) {
      setError('Username and password are required.');
      return;
    }

    setRegisterLoading(true);
    try {
      // Register via AuthContext so token + user state are set globally.
      // After authRegister, the authenticated useEffect above will auto-claim the invite.
      await authRegister(trimmedUsername, password, trimmedDisplayName || trimmedUsername);
    } catch (err) {
      setError(inviteErrorMessage(err));
    } finally {
      setRegisterLoading(false);
    }
  }, [username, password, displayName, authRegister]);

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

  const guildName = invite.guildName ?? invite.instanceName ?? 'a guild';

  // Authenticated: show redirecting state while auto-claim runs
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

  // Unauthenticated: show registration form
  return (
    <div style={styles.page}>
      <div className="glass" style={styles.card}>
        <p style={styles.title}>You're invited to join</p>
        <p style={styles.guildName}>{guildName}</p>
        {error && <p style={styles.error}>{error}</p>}
        <form style={styles.form} onSubmit={handleRegisterAndClaim}>
          <div>
            <label htmlFor="invite-username" style={styles.fieldLabel}>Username</label>
            <input
              id="invite-username"
              name="username"
              className="input"
              type="text"
              placeholder="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={32}
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label htmlFor="invite-display-name" style={styles.fieldLabel}>Display name (optional)</label>
            <input
              id="invite-display-name"
              name="displayName"
              className="input"
              type="text"
              placeholder="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={64}
              autoComplete="name"
            />
          </div>
          <div>
            <label htmlFor="invite-password" style={styles.fieldLabel}>Password</label>
            <input
              id="invite-password"
              name="password"
              className="input"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={registerLoading}
            style={{ width: '100%', padding: '12px' }}
          >
            {registerLoading ? 'Creating account…' : 'Create account and join'}
          </button>
        </form>
        <a href="/" style={styles.link}>Return to home</a>
      </div>
    </div>
  );
}
