/**
 * DeviceManagement — device list with revoke + linking controls.
 *
 * Displayed inside UserSettingsModal (Devices tab).
 *
 * Props:
 *   token         — JWT for API calls
 *   currentDeviceId — device ID for this browser session (shows "This device" badge)
 */

import { useState, useEffect, useCallback } from 'react';
import { listDeviceKeys, revokeDeviceKey } from '../lib/api.js';
import DeviceLinkModal from './auth/DeviceLinkModal.jsx';

const styles = {
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    marginBottom: '24px',
  },
  th: {
    fontSize: '0.7rem',
    fontWeight: 700,
    color: 'var(--hush-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    padding: '0 0 8px 0',
    textAlign: 'left',
    borderBottom: '1px solid var(--hush-border)',
  },
  td: {
    padding: '10px 0',
    fontSize: '0.85rem',
    color: 'var(--hush-text)',
    borderBottom: '1px solid var(--hush-border)',
    verticalAlign: 'middle',
  },
  deviceName: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  badge: {
    fontSize: '0.65rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--hush-amber)',
    background: 'var(--hush-amber-ghost)',
    padding: '2px 6px',
    flexShrink: 0,
  },
  revokeBtn: {
    background: 'none',
    border: '1px solid transparent',
    color: 'var(--hush-danger)',
    fontSize: '0.8rem',
    fontFamily: 'var(--font-sans)',
    cursor: 'pointer',
    padding: '4px 8px',
    transition: 'background var(--duration-fast) var(--ease-out)',
  },
  emptyState: {
    color: 'var(--hush-text-muted)',
    fontSize: '0.85rem',
    padding: '24px 0',
    textAlign: 'center',
  },
  actions: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  errorMsg: {
    color: 'var(--hush-danger)',
    fontSize: '0.8rem',
    marginBottom: '12px',
  },
  confirmOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 300,
  },
  confirmModal: {
    background: 'var(--hush-surface)',
    border: '1px solid transparent',
    padding: '28px',
    width: '100%',
    maxWidth: '360px',
  },
  confirmTitle: {
    fontSize: '1rem',
    fontWeight: 600,
    color: 'var(--hush-text)',
    marginBottom: '12px',
  },
  confirmText: {
    fontSize: '0.85rem',
    color: 'var(--hush-text-secondary)',
    marginBottom: '24px',
  },
  confirmActions: {
    display: 'flex',
    gap: '8px',
    justifyContent: 'flex-end',
  },
};

function formatRelativeTime(dateStr) {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function RevokeConfirm({ deviceLabel, onConfirm, onCancel, loading }) {
  return (
    <div style={styles.confirmOverlay}>
      <div style={styles.confirmModal}>
        <div style={styles.confirmTitle}>Revoke device?</div>
        <div style={styles.confirmText}>
          Remove <strong>{deviceLabel}</strong> from your account.
          It will no longer be able to access your account.
        </div>
        <div style={styles.confirmActions}>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={loading}>
            {loading ? 'Revoking...' : 'Revoke device'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DeviceManagement({ token, currentDeviceId }) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(null); // { deviceId, label }
  const [revoking, setRevoking] = useState(false);

  const fetchDevices = useCallback(async () => {
    if (!token) return;
    try {
      setError(null);
      const data = await listDeviceKeys(token);
      setDevices(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || 'Failed to load devices');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  const handleRevoke = useCallback(async () => {
    if (!confirmRevoke || !token) return;
    setRevoking(true);
    try {
      await revokeDeviceKey(token, confirmRevoke.deviceId);
      setConfirmRevoke(null);
      await fetchDevices();
    } catch (err) {
      setError(err.message || 'Failed to revoke device');
    } finally {
      setRevoking(false);
    }
  }, [confirmRevoke, token, fetchDevices]);

  const handleLinked = useCallback(() => {
    setShowLinkModal(false);
    fetchDevices();
  }, [fetchDevices]);

  return (
    <>
      <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--hush-text)', marginBottom: '8px', paddingBottom: '16px', borderBottom: '1px solid var(--hush-border)' }}>
        Devices
      </div>

      {error && <div style={styles.errorMsg}>{error}</div>}

      {loading ? (
        <div style={styles.emptyState}>Loading devices...</div>
      ) : devices.length === 0 ? (
        <div style={styles.emptyState}>No devices registered.</div>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Device</th>
              <th style={styles.th}>Last active</th>
              <th style={styles.th}>Linked</th>
              <th style={{ ...styles.th, textAlign: 'right' }}></th>
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => {
              const isCurrent = device.deviceId === currentDeviceId;
              const displayLabel = device.label || device.deviceId || 'Unknown device';
              return (
                <tr key={device.deviceId}>
                  <td style={styles.td}>
                    <div style={styles.deviceName}>
                      <span>{displayLabel}</span>
                      {isCurrent && <span style={styles.badge}>This device</span>}
                    </div>
                  </td>
                  <td style={styles.td}>
                    {formatRelativeTime(device.lastSeen)}
                  </td>
                  <td style={styles.td}>
                    {device.certifiedAt
                      ? new Date(device.certifiedAt).toLocaleDateString()
                      : '\u2014'}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    {!isCurrent && (
                      <button
                        type="button"
                        style={styles.revokeBtn}
                        onClick={() => setConfirmRevoke({ deviceId: device.deviceId, label: displayLabel })}
                        title={`Revoke ${displayLabel}`}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div style={styles.actions}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setShowLinkModal(true)}
        >
          Link a new device
        </button>
      </div>

      {showLinkModal && (
        <DeviceLinkModal
          onClose={() => setShowLinkModal(false)}
          onLinked={handleLinked}
          token={token}
          currentDeviceId={currentDeviceId}
        />
      )}

      {confirmRevoke && (
        <RevokeConfirm
          deviceLabel={confirmRevoke.label}
          onConfirm={handleRevoke}
          onCancel={() => setConfirmRevoke(null)}
          loading={revoking}
        />
      )}
    </>
  );
}
