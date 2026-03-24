/**
 * DeviceLinkModal — shows a new device linking flow to the user.
 *
 * The new device generates a fresh Ed25519 keypair and displays either:
 *   - A QR code containing the encoded public key payload (QR tab).
 *   - An 8-character text code registered with the server (Code tab).
 *
 * The existing device scans the QR / enters the code, signs a certificate,
 * and calls certifyNewDevice. This component polls for successful linking.
 *
 * Props:
 *   onClose        — called when the modal is dismissed
 *   onLinked       — called with no args when the new device has been certified
 *   token          — JWT of the currently authenticated session (for polling)
 *   currentDeviceId — the device ID of the current (new) device
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as ed from '@noble/ed25519';
import QRCode from 'qrcode';
import { encodeQRPayload, generateLinkingCode } from '../../lib/deviceLinking.js';
import { listDeviceKeys } from '../../lib/api.js';
import { useBreakpoint } from '../../hooks/useBreakpoint.js';

const LINK_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL_MS = 3000;
const CODE_TAB = 'code';
const QR_TAB = 'qr';

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 300,
  },
  modal: {
    background: 'var(--hush-surface)',
    border: '1px solid transparent',
    borderRadius: 0,
    padding: '28px',
    width: '100%',
    maxWidth: '400px',
    position: 'relative',
    animation: 'modal-enter var(--duration-slow) var(--ease-spring)',
  },
  title: {
    fontSize: '1rem',
    fontWeight: 600,
    color: 'var(--hush-text)',
    marginBottom: '6px',
  },
  subtitle: {
    fontSize: '0.85rem',
    color: 'var(--hush-text-secondary)',
    marginBottom: '20px',
  },
  tabBar: {
    display: 'flex',
    gap: '2px',
    borderBottom: '1px solid var(--hush-border)',
    marginBottom: '24px',
  },
  tab: (active) => ({
    padding: '8px 16px',
    background: 'none',
    border: 'none',
    borderBottom: active ? '2px solid var(--hush-amber)' : '2px solid transparent',
    color: active ? 'var(--hush-text)' : 'var(--hush-text-secondary)',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.85rem',
    fontWeight: active ? 500 : 400,
    cursor: 'pointer',
    transition: 'all var(--duration-fast) var(--ease-out)',
  }),
  canvasWrapper: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '16px',
    background: '#fff',
    padding: '16px',
  },
  codeDisplay: {
    fontFamily: 'var(--font-mono)',
    fontSize: '2rem',
    fontWeight: 500,
    letterSpacing: '0.15em',
    color: 'var(--hush-amber)',
    textAlign: 'center',
    padding: '20px 0',
  },
  timer: {
    fontSize: '0.75rem',
    color: 'var(--hush-text-muted)',
    textAlign: 'center',
    marginBottom: '12px',
  },
  timerExpired: {
    fontSize: '0.75rem',
    color: 'var(--hush-danger)',
    textAlign: 'center',
    marginBottom: '12px',
  },
  instructions: {
    fontSize: '0.8rem',
    color: 'var(--hush-text-secondary)',
    textAlign: 'center',
    lineHeight: 1.5,
    marginBottom: '20px',
  },
  actions: {
    display: 'flex',
    gap: '8px',
    justifyContent: 'flex-end',
  },
  copyRow: {
    display: 'flex',
    gap: '8px',
    justifyContent: 'center',
    marginBottom: '16px',
  },
  statusRow: {
    fontSize: '0.8rem',
    color: 'var(--hush-text-muted)',
    textAlign: 'center',
    minHeight: '20px',
  },
  closeBtn: {
    position: 'absolute',
    top: '12px',
    right: '12px',
    background: 'none',
    border: '1px solid var(--hush-border)',
    borderRadius: '50%',
    width: '28px',
    height: '28px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--hush-text-secondary)',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.9rem',
  },
};

export default function DeviceLinkModal({ onClose, onLinked, token, currentDeviceId }) {
  const [activeTab, setActiveTab] = useState(QR_TAB);
  const [expiresAt] = useState(() => Date.now() + LINK_EXPIRY_MS);
  const [secondsLeft, setSecondsLeft] = useState(Math.floor(LINK_EXPIRY_MS / 1000));
  const [expired, setExpired] = useState(false);
  const [status, setStatus] = useState('');
  const [copied, setCopied] = useState(false);
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';

  // QR state: new device keypair + encoded QR payload.
  const [qrPayload, setQrPayload] = useState(null);
  const canvasRef = useRef(null);

  // Code state: 8-char linking code.
  const [linkCode, setLinkCode] = useState(null);

  // Polling ref — cleared on linked/expired.
  const pollRef = useRef(null);
  const linkedDeviceCountRef = useRef(null);

  // ── Generate keypair + QR payload on mount ────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    async function init() {
      // New device generates its own Ed25519 keypair.
      const privKey = ed.utils.randomPrivateKey();
      const pubKey = await ed.getPublicKeyAsync(privKey);
      // Ephemeral key for DH (not used in this implementation, but included for
      // protocol completeness per the QR payload spec in deviceLinking.js).
      const ephemeralPriv = ed.utils.randomPrivateKey();
      const ephemeralPub = await ed.getPublicKeyAsync(ephemeralPriv);
      const nonce = crypto.getRandomValues(new Uint8Array(16));
      const expiry = new Date(expiresAt).toISOString();

      const encoded = encodeQRPayload({
        devicePublicKey: pubKey,
        ephemeralPublicKey: ephemeralPub,
        expiry,
        nonce,
      });

      if (!cancelled) setQrPayload(encoded);
    }
    init();
    return () => { cancelled = true; };
  }, [expiresAt]);

  // ── Render QR code onto canvas whenever payload changes ───────────────────

  useEffect(() => {
    if (!qrPayload || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, qrPayload, {
      width: 200,
      errorCorrectionLevel: 'M',
      margin: 2,
    }).catch((err) => console.error('QR render failed', err));
  }, [qrPayload, activeTab]);

  // ── Generate linking code on Code tab ─────────────────────────────────────

  useEffect(() => {
    if (activeTab !== CODE_TAB || linkCode) return;
    setLinkCode(generateLinkingCode());
  }, [activeTab, linkCode]);

  // ── Countdown timer ───────────────────────────────────────────────────────

  useEffect(() => {
    const id = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        setExpired(true);
        clearInterval(id);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  // ── Poll device list to detect successful linking ─────────────────────────

  useEffect(() => {
    if (expired || !token) return;

    // Capture baseline device count on first poll.
    let baselineCount = linkedDeviceCountRef.current;

    const poll = async () => {
      try {
        const devices = await listDeviceKeys(token);
        const count = Array.isArray(devices) ? devices.length : 0;
        if (baselineCount === null) {
          baselineCount = count;
          linkedDeviceCountRef.current = count;
          return;
        }
        if (count > baselineCount) {
          setStatus('New device linked successfully.');
          clearInterval(pollRef.current);
          setTimeout(() => onLinked?.(), 1500);
        }
      } catch {
        // Best-effort; ignore transient network errors.
      }
    };

    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    poll(); // immediate first check
    return () => clearInterval(pollRef.current);
  }, [token, expired, onLinked]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const handleCopy = useCallback(() => {
    if (!linkCode) return;
    navigator.clipboard.writeText(linkCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [linkCode]);

  const formatTimer = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return createPortal(
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ ...styles.modal, ...(isMobile ? { margin: '16px', maxWidth: 'none' } : {}) }}>
        <button type="button" style={styles.closeBtn} onClick={onClose} title="Close">
          &#x2715;
        </button>

        <div style={styles.title}>Link a new device</div>
        <div style={styles.subtitle}>
          Show this to your other device to link it to your account.
        </div>

        <div style={styles.tabBar}>
          <button type="button" style={styles.tab(activeTab === QR_TAB)} onClick={() => setActiveTab(QR_TAB)}>
            QR code
          </button>
          <button type="button" style={styles.tab(activeTab === CODE_TAB)} onClick={() => setActiveTab(CODE_TAB)}>
            Text code
          </button>
        </div>

        {activeTab === QR_TAB && (
          <>
            <div style={styles.canvasWrapper}>
              {qrPayload ? (
                <canvas ref={canvasRef} />
              ) : (
                <div style={{ width: 200, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--hush-text-muted)', fontSize: '0.8rem' }}>
                  Generating...
                </div>
              )}
            </div>
            <div style={expired ? styles.timerExpired : styles.timer}>
              {expired ? 'Expired — close and try again' : `Expires in ${formatTimer(secondsLeft)}`}
            </div>
            <div style={styles.instructions}>
              Scan this QR code from the new device you want to link.
            </div>
          </>
        )}

        {activeTab === CODE_TAB && (
          <>
            <div style={styles.codeDisplay}>
              {linkCode || '--------'}
            </div>
            <div style={expired ? styles.timerExpired : styles.timer}>
              {expired ? 'Expired — close and try again' : `Expires in ${formatTimer(secondsLeft)}`}
            </div>
            <div style={styles.copyRow}>
              <button type="button" className="btn btn-secondary" onClick={handleCopy} disabled={!linkCode || expired}>
                {copied ? 'Copied' : 'Copy code'}
              </button>
            </div>
            <div style={styles.instructions}>
              Enter this code on the new device you want to link.
            </div>
          </>
        )}

        <div style={styles.statusRow}>{status}</div>

        <div style={styles.actions}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
