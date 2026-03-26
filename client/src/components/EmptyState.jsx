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
    <div className="empty-container" data-testid="empty-state">
      <div className="empty-icon" aria-hidden="true">
        {/* Simple server icon (Lucide-style) */}
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="2" width="20" height="8" rx="0" />
          <rect x="2" y="14" width="20" height="8" rx="0" />
          <line x1="6" y1="6" x2="6.01" y2="6" />
          <line x1="6" y1="18" x2="6.01" y2="18" />
        </svg>
      </div>

      <h2 className="empty-heading">Welcome to hush</h2>

      <p className="empty-description">
        Your private space for encrypted screen sharing and chat.
        No servers here yet — find one below or get your own.
      </p>

      <button
        type="button"
        className="empty-btn-primary"
        onClick={onBrowseServers}
      >
        Browse public servers
      </button>

      <p className="empty-invite-hint">
        Have an invite link? Just click it — you&apos;ll be connected automatically.
      </p>

      {canCreateServer && (
        <button
          type="button"
          className="empty-btn-secondary"
          onClick={onCreateServer}
        >
          Create a server
        </button>
      )}

      <div className="empty-footer">
        <a
          href="https://gethush.live"
          target="_blank"
          rel="noopener noreferrer"
          className="empty-footer-link"
        >
          Get a server
        </a>
        <span className="empty-footer-dot" aria-hidden="true">·</span>
        <a
          href="https://gethush.live/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="empty-footer-link"
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
