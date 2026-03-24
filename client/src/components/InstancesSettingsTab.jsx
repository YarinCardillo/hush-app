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
    <div style={{
      marginTop: '8px',
      padding: '12px 16px',
      background: 'var(--hush-black)',
      border: '1px solid var(--hush-danger)',
    }}>
      <div style={{
        fontSize: '0.85rem',
        color: 'var(--hush-text-secondary)',
        marginBottom: '12px',
        lineHeight: 1.6,
      }}>
        Disconnect from <strong style={{ color: 'var(--hush-text)' }}>{domain}</strong>?
        This will leave all {label} on this instance.
      </div>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
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
    <div style={{
      borderBottom: '1px solid var(--hush-border)',
      paddingBottom: confirming ? '0' : '0',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '12px 0',
      }}>
        {/* Status dot */}
        <div style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: indicator.color,
          flexShrink: 0,
        }} title={indicator.label} />

        {/* Domain + server count */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: '0.9rem',
            fontWeight: 500,
            color: 'var(--hush-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {domain}
          </div>
          <div style={{
            fontSize: '0.75rem',
            color: 'var(--hush-text-muted)',
            marginTop: '2px',
          }}>
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
            onClick={handleDisconnectClick}
            style={{
              padding: '6px 12px',
              background: 'var(--hush-danger-ghost)',
              color: 'var(--hush-danger)',
              border: '1px solid transparent',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.75rem',
              fontFamily: 'var(--font-sans)',
              fontWeight: 500,
              cursor: 'pointer',
              flexShrink: 0,
              transition: 'background var(--duration-fast) var(--ease-out)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--hush-danger-ghost)'; }}
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
      <div style={{
        fontSize: '1rem',
        fontWeight: 600,
        color: 'var(--hush-text)',
        marginBottom: '24px',
        paddingBottom: '16px',
        borderBottom: '1px solid var(--hush-border)',
      }}>
        My Instances
      </div>

      {entries.length === 0 ? (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '48px 0',
          gap: '12px',
          textAlign: 'center',
        }}>
          <div style={{
            fontSize: '1rem',
            fontWeight: 500,
            color: 'var(--hush-text-secondary)',
          }}>
            No instances connected
          </div>
          <div style={{
            fontSize: '0.85rem',
            color: 'var(--hush-text-muted)',
            maxWidth: '280px',
          }}>
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

      <div style={{
        marginTop: '24px',
        fontSize: '0.75rem',
        color: 'var(--hush-text-muted)',
        lineHeight: 1.6,
      }}>
        Disconnecting from an instance leaves all servers on that instance and
        stops the connection. You can reconnect by joining a server via invite link.
      </div>
    </>
  );
}
