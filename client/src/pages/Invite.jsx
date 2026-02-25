import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getInviteByCode, joinServer } from '../lib/api';
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
  serverName: {
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
  if (/already a member|409/i.test(msg)) return "You're already in this server.";
  if (/invalid|expired|400/i.test(msg)) return 'Invite is invalid or expired.';
  return msg || 'Something went wrong.';
}

export default function Invite() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { token, isAuthenticated } = useAuth();
  const [invite, setInvite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [joinLoading, setJoinLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!code) {
      setLoading(false);
      setError('Invalid invite link.');
      return;
    }
    let cancelled = false;
    getInviteByCode(code)
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

  const handleJoin = useCallback(async () => {
    if (!invite || !token || !code) return;
    setError(null);
    setJoinLoading(true);
    try {
      await joinServer(token, invite.serverId, { inviteCode: code });
      navigate(`/server/${invite.serverId}`, { replace: true });
    } catch (err) {
      setError(inviteErrorMessage(err));
    } finally {
      setJoinLoading(false);
    }
  }, [invite, token, code, navigate]);

  const handleSignInToJoin = useCallback(() => {
    navigate(`/?join=${encodeURIComponent(code)}`, { replace: true });
  }, [navigate, code]);

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

  if (!invite) {
    return null;
  }

  return (
    <div style={styles.page}>
      <div className="glass" style={styles.card}>
        <p style={styles.title}>You’re invited to join</p>
        <p style={styles.serverName}>{invite.serverName}</p>
        {error && <p style={styles.error}>{error}</p>}
        <div style={styles.actions}>
          {isAuthenticated ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleJoin}
              disabled={joinLoading}
              style={{ width: '100%', padding: '12px' }}
            >
              {joinLoading ? 'Joining…' : 'Join'}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSignInToJoin}
              style={{ width: '100%', padding: '12px' }}
            >
              Sign in to join
            </button>
          )}
          <a href="/" style={styles.link}>Return to home</a>
        </div>
      </div>
    </div>
  );
}
