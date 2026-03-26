import { useState, useContext } from 'react';
import { InstanceContext } from '../contexts/InstanceContext.jsx';

// ── Connection status indicator ──────────────────────────────────────────────

/**
 * Returns the dot color and label for a given connectionState.
 * @param {string} state - 'connected'|'reconnecting'|'connecting'|'offline'
 * @returns {{ color: string, label: string }}
 */
function statusIndicator(state) {
  switch (state) {
    case 'connected':
      return { color: 'var(--hush-live)', label: 'connected' };
    case 'reconnecting':
    case 'connecting':
      return { color: '#f59e0b', label: state };
    default:
      return { color: 'var(--hush-danger)', label: 'offline' };
  }
}

// ── Disconnect confirmation modal ─────────────────────────────────────────────

/**
 * Inline confirmation panel shown within the instance row.
 * Avoids portal complexity — styled inline below the row.
 *
 * @param {{ domain: string, serverCount: number, onConfirm: Function, onCancel: Function, loading: boolean }} props
 */
function DisconnectConfirm({ domain, serverCount, onConfirm, onCancel, loading }) {
  const label = serverCount === 1 ? '1 server' : `${serverCount} servers`;
  return (
    <div className="ist-confirm">
      <div className="ist-confirm-text">
        Disconnect from <strong style={{ color: 'var(--hush-text)' }}>{domain}</strong>?
        This will leave all {label} on this instance.
      </div>
      <div className="ist-confirm-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onCancel}
          disabled={loading}
          style={{ fontSize: '0.8rem', padding: '7px 14px' }}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-danger"
          onClick={onConfirm}
          disabled={loading}
          style={{ fontSize: '0.8rem', padding: '7px 14px' }}
        >
          {loading ? 'Disconnecting\u2026' : 'Disconnect'}
        </button>
      </div>
    </div>
  );
}

// ── Instance row ─────────────────────────────────────────────────────────────

/**
 * A single row in the instance list.
 *
 * @param {{ instanceUrl: string, state: object, onDisconnect: Function }} props
 */
function InstanceRow({ instanceUrl, state, onDisconnect }) {
  const [confirming, setConfirming] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  let domain = instanceUrl;
  try {
    domain = new URL(instanceUrl).hostname;
  } catch {
    // fallback to raw URL if parse fails
  }

  const serverCount = state?.guilds?.length ?? 0;
  const indicator = statusIndicator(state?.connectionState ?? 'offline');

  const handleDisconnectClick = () => setConfirming(true);
  const handleCancel = () => setConfirming(false);

  const handleConfirm = async () => {
    setDisconnecting(true);
    try {
      await onDisconnect(instanceUrl);
    } finally {
      setDisconnecting(false);
      setConfirming(false);
    }
  };

  return (
    <div className="ist-row">
      <div className="ist-row-inner">
        {/* Status dot — color is dynamic per connection state */}
        <div
          className="ist-status-dot"
          style={{ background: indicator.color }}
          title={indicator.label}
        />

        {/* Domain + server count */}
        <div className="ist-row-info">
          <div className="ist-domain">{domain}</div>
          <div className="ist-sub">
            {serverCount === 0
              ? 'No servers'
              : serverCount === 1
                ? '1 server'
                : `${serverCount} servers`}
            {' \u00b7 '}
            <span style={{ color: indicator.color }}>{indicator.label}</span>
          </div>
        </div>

        {/* Disconnect button — only shown when not already confirming */}
        {!confirming && (
          <button
            type="button"
            className="ist-disconnect-btn"
            onClick={handleDisconnectClick}
          >
            Disconnect
          </button>
        )}
      </div>

      {confirming && (
        <DisconnectConfirm
          domain={domain}
          serverCount={serverCount}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          loading={disconnecting}
        />
      )}
    </div>
  );
}

// ── Main tab component ────────────────────────────────────────────────────────

/**
 * Settings tab for managing connected instances.
 * Renders in UserSettingsModal alongside Account, Appearance, Audio & Video, and Devices.
 *
 * Uses InstanceContext directly (does not throw if missing — graceful degradation for
 * environments where InstanceProvider has not been mounted yet).
 */
export default function InstancesSettingsTab() {
  const ctx = useContext(InstanceContext);

  const instanceStates = ctx?.instanceStates ?? new Map();
  const disconnectInstance = ctx?.disconnectInstance ?? null;

  const entries = Array.from(instanceStates.entries());

  return (
    <>
      <div className="ist-header">
        My Instances
      </div>

      {entries.length === 0 ? (
        <div className="ist-empty">
          <div className="ist-empty-title">No instances connected</div>
          <div className="ist-empty-hint">
            Join a server via invite link or create one to connect to an instance.
          </div>
        </div>
      ) : (
        <div>
          {entries.map(([instanceUrl, state]) => (
            <InstanceRow
              key={instanceUrl}
              instanceUrl={instanceUrl}
              state={state}
              onDisconnect={disconnectInstance ?? (() => Promise.resolve())}
            />
          ))}
        </div>
      )}

      <div className="ist-footer-note">
        Disconnecting from an instance leaves all servers on that instance and
        stops the connection. You can reconnect by joining a server via invite link.
      </div>
    </>
  );
}
