/**
 * EmptyState — shown in the main content area when the user has no guild memberships.
 *
 * Renders:
 *   1. Welcome heading
 *   2. "Browse public servers" primary button
 *   3. Invite link explanation paragraph
 *   4. "Create a server" secondary button (conditional — visible only when at least one
 *      connected instance has server_creation_policy in ['open', 'any_member'])
 *   5. Footer links: "Get a server" and "Self-host" (external)
 *
 * @param {{
 *   instanceStates: Map<string, { connectionState: string, handshakeData: object }>,
 *   onCreateServer: () => void,
 *   onBrowseServers: () => void,
 * }} props
 */
export default function EmptyState({ instanceStates, onCreateServer, onBrowseServers }) {
  const canCreateServer = _canCreateServer(instanceStates);

  return (
    <div style={styles.container} data-testid="empty-state">
      <div style={styles.icon} aria-hidden="true">
        {/* Simple server icon (Lucide-style) */}
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="2" width="20" height="8" rx="0" />
          <rect x="2" y="14" width="20" height="8" rx="0" />
          <line x1="6" y1="6" x2="6.01" y2="6" />
          <line x1="6" y1="18" x2="6.01" y2="18" />
        </svg>
      </div>

      <h2 style={styles.heading}>Welcome to hush</h2>

      <p style={styles.description}>
        Your private space for encrypted screen sharing and chat.
        No servers here yet — find one below or get your own.
      </p>

      <button
        type="button"
        style={styles.btnPrimary}
        onClick={onBrowseServers}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--hush-amber-bright)';
          e.currentTarget.style.boxShadow = '0 0 24px var(--hush-amber-glow)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--hush-amber)';
          e.currentTarget.style.boxShadow = 'none';
        }}
      >
        Browse public servers
      </button>

      <p style={styles.inviteHint}>
        Have an invite link? Just click it — you&apos;ll be connected automatically.
      </p>

      {canCreateServer && (
        <button
          type="button"
          style={styles.btnSecondary}
          onClick={onCreateServer}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--hush-elevated)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--hush-surface)';
          }}
        >
          Create a server
        </button>
      )}

      <div style={styles.footer}>
        <a
          href="https://gethush.live"
          target="_blank"
          rel="noopener noreferrer"
          style={styles.footerLink}
        >
          Get a server
        </a>
        <span style={styles.footerDot} aria-hidden="true">·</span>
        <a
          href="https://gethush.live/docs"
          target="_blank"
          rel="noopener noreferrer"
          style={styles.footerLink}
        >
          Self-host
        </a>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Policies that permit regular members to create servers. */
const CREATION_ALLOWED_POLICIES = new Set(['open', 'any_member']);

/**
 * Returns true if at least one connected instance allows server creation
 * by regular members.
 *
 * @param {Map<string, object>} instanceStates
 * @returns {boolean}
 */
function _canCreateServer(instanceStates) {
  for (const state of instanceStates.values()) {
    const policy = state?.handshakeData?.server_creation_policy;
    if (CREATION_ALLOWED_POLICIES.has(policy)) return true;
  }
  return false;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    textAlign: 'center',
    padding: 40,
    gap: 16,
    maxWidth: 480,
    margin: '0 auto',
  },
  icon: {
    width: 56,
    height: 56,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--hush-surface)',
    border: '1px solid transparent',
    color: 'var(--hush-text-ghost)',
    borderRadius: 0,
  },
  heading: {
    fontSize: '1.4rem',
    fontWeight: 300,
    color: 'var(--hush-text)',
    letterSpacing: '-0.02em',
    margin: 0,
  },
  description: {
    fontSize: '0.85rem',
    color: 'var(--hush-text-muted)',
    maxWidth: 320,
    margin: 0,
    lineHeight: 1.6,
  },
  btnPrimary: {
    background: 'var(--hush-amber)',
    color: 'var(--hush-black)',
    fontWeight: 500,
    border: 'none',
    borderRadius: 0,
    padding: '10px 24px',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.9rem',
    transition: 'all var(--duration-fast) var(--ease-out)',
  },
  inviteHint: {
    fontSize: '0.8rem',
    color: 'var(--hush-text-muted)',
    maxWidth: 280,
    margin: 0,
    lineHeight: 1.5,
  },
  btnSecondary: {
    background: 'var(--hush-surface)',
    color: 'var(--hush-text)',
    border: '1px solid transparent',
    borderRadius: 0,
    padding: '10px 24px',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.9rem',
    transition: 'all var(--duration-fast) var(--ease-out)',
  },
  footer: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  footerLink: {
    fontSize: '0.8rem',
    color: 'var(--hush-text-muted)',
    textDecoration: 'none',
    transition: 'color var(--duration-fast) var(--ease-out)',
  },
  footerDot: {
    color: 'var(--hush-text-ghost)',
    fontSize: '0.8rem',
  },
};
