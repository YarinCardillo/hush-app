import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { useAuth } from '../contexts/AuthContext';
import { BODY_SCROLL_MODE, useBodyScrollMode } from '../hooks/useBodyScrollMode';
import { getDeviceId } from '../hooks/useAuth';
import * as mlsStore from '../lib/mlsStore';
import {
  consumeDeviceLinkResult,
  createDeviceLinkRequest,
  resolveDeviceLinkRequest,
  verifyDeviceLinkRequest,
} from '../lib/api';
import {
  buildLinkApprovalUrl,
  bytesToBase64,
  certifyDevice,
  createDeviceIdentity,
  createSessionKeyPair,
  decodeQRPayload,
  decodeTransferBundle,
  decryptRelayPayload,
  encodeTransferBundle,
  encryptRelayPayload,
  base64ToBytes,
} from '../lib/deviceLinking';

const POLL_INTERVAL_MS = 3000;

function formatCountdown(expiresAt, now = Date.now()) {
  const remaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function NewDeviceLinkView({ onLinked }) {
  const { completeDeviceLink, loading: authLoading } = useAuth();
  const [requestState, setRequestState] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function createRequest() {
      setError('');
      setStatus('');
      setRequestState(null);

      try {
        const deviceIdentity = await createDeviceIdentity();
        const session = await createSessionKeyPair();
        const response = await createDeviceLinkRequest({
          devicePublicKey: deviceIdentity.publicKeyBase64,
          sessionPublicKey: session.publicKeyBase64,
          deviceId: getDeviceId(),
          instanceUrl: window.location.origin,
        });
        const qrUrl = buildLinkApprovalUrl(window.location.origin, {
          requestId: response.requestId,
          secret: response.secret,
          expiresAt: response.expiresAt,
        });
        const qrDataUrl = await QRCode.toDataURL(qrUrl, {
          width: 240,
          margin: 2,
          errorCorrectionLevel: 'M',
        });

        if (cancelled) return;
        setRequestState({
          ...response,
          qrDataUrl,
          sessionPrivateKey: session.privateKey,
        });
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Failed to create a device link request.');
        }
      }
    }

    createRequest();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  useEffect(() => {
    if (!requestState?.requestId || !requestState?.secret || !requestState?.sessionPrivateKey) return undefined;

    let cancelled = false;
    const expiresAtMs = new Date(requestState.expiresAt).getTime();

    const poll = async () => {
      if (cancelled || Date.now() >= expiresAtMs) return;
      try {
        const result = await consumeDeviceLinkResult({
          requestId: requestState.requestId,
          secret: requestState.secret,
        });
        if (cancelled || result?.status === 'pending') return;

        setStatus('Finalizing linked device…');
        const relayBytes = await decryptRelayPayload(result, requestState.sessionPrivateKey);
        const bundle = decodeTransferBundle(relayBytes);
        await completeDeviceLink(bundle);
        onLinked();
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Failed to finalize the device link.');
        }
      }
    };

    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [completeDeviceLink, onLinked, requestState]);

  const isExpired = requestState
    ? new Date(requestState.expiresAt).getTime() <= now
    : false;

  return (
    <div className="glass home-form-card ld-card">
      <div className="home-section-title">Link this device</div>
      <p className="ld-subtitle">
        Scan this QR code from a device that is already signed in to the same account.
      </p>

      {requestState?.qrDataUrl && !isExpired ? (
        <>
          <img className="ld-qr-image" src={requestState.qrDataUrl} alt="Device link QR code" />
          <div className="ld-code-label">Desktop fallback code</div>
          <div className="ld-code-value">{requestState.code}</div>
          <div className="ld-timer">Expires in {formatCountdown(requestState.expiresAt, now)}</div>
        </>
      ) : (
        <div className="ld-empty-box">
          {authLoading ? 'Finalizing device link…' : isExpired ? 'Link request expired.' : 'Generating link request…'}
        </div>
      )}

      {status && <div className="ld-status">{status}</div>}
      {error && <div className="ld-error">{error}</div>}

      <div className="ld-actions">
        <button type="button" className="btn btn-secondary" onClick={() => setRefreshKey((value) => value + 1)}>
          Regenerate
        </button>
        <Link className="btn btn-secondary" to="/">
          Back
        </Link>
      </div>
    </div>
  );
}

function ApproveLinkView({ initialPayload }) {
  const navigate = useNavigate();
  const {
    user,
    token,
    loading,
    isAuthenticated,
    vaultState,
    identityKeyRef,
  } = useAuth();
  const [code, setCode] = useState('');
  const [claim, setClaim] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [isResolving, setIsResolving] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const canApprove = isAuthenticated && vaultState === 'unlocked' && !!identityKeyRef.current?.privateKey && !!token;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const resolveRequest = useCallback(async (body) => {
    if (!token) return;
    setError('');
    setStatus('');
    setIsResolving(true);
    try {
      const resolved = await resolveDeviceLinkRequest(token, body);
      setClaim(resolved);
    } catch (err) {
      setError(err.message || 'Failed to resolve the link request.');
    } finally {
      setIsResolving(false);
    }
  }, [token]);

  useEffect(() => {
    if (!initialPayload?.requestId || !initialPayload?.secret || !canApprove) return;
    resolveRequest({
      requestId: initialPayload.requestId,
      secret: initialPayload.secret,
    });
  }, [canApprove, initialPayload, resolveRequest]);

  const handleResolveCode = useCallback(async (event) => {
    event.preventDefault();
    if (!code.trim()) {
      setError('Enter the code shown on the new device.');
      return;
    }
    await resolveRequest({ code: code.trim().toUpperCase() });
  }, [code, resolveRequest]);

  const handleApprove = useCallback(async () => {
    if (!claim || !token || !user?.id || !identityKeyRef.current?.privateKey || !identityKeyRef.current?.publicKey) {
      return;
    }

    setError('');
    setStatus('');
    setIsApproving(true);
    let historyDb = null;
    try {
      historyDb = await mlsStore.openStore(user.id, getDeviceId());
      const historySnapshot = await mlsStore.exportHistorySnapshot(historyDb);
      const transferBundle = encodeTransferBundle({
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        instanceUrl: claim.instanceUrl || window.location.origin,
        rootPrivateKey: identityKeyRef.current.privateKey,
        rootPublicKey: identityKeyRef.current.publicKey,
        historySnapshot,
      });
      const certificate = await certifyDevice(
        base64ToBytes(claim.devicePublicKey),
        identityKeyRef.current.privateKey,
      );
      const relayEnvelope = await encryptRelayPayload(transferBundle, claim.sessionPublicKey);

      await verifyDeviceLinkRequest(token, {
        claimToken: claim.claimToken,
        certificate: bytesToBase64(certificate),
        signingDeviceId: getDeviceId(),
        ...relayEnvelope,
      });

      setStatus('Device linked. Return to the new device to finish setup.');
    } catch (err) {
      setError(err.message || 'Failed to approve the device link.');
    } finally {
      try {
        historyDb?.close();
      } catch {
        // Ignore close errors.
      }
      setIsApproving(false);
    }
  }, [claim, identityKeyRef, token, user?.displayName, user?.id, user?.username]);

  if (loading) {
    return (
      <div className="glass home-form-card ld-card">
        <div className="ld-empty-box">Loading…</div>
      </div>
    );
  }

  if (!canApprove) {
    return (
      <div className="glass home-form-card ld-card">
        <div className="home-section-title">Approve device link</div>
        <p className="ld-subtitle">
          Open this page on a device that is already signed in and unlocked for the account you want to link.
        </p>
        {initialPayload && (
          <div className="ld-status">
            QR request detected. Unlock this device, then reopen or rescan the QR code.
          </div>
        )}
        <div className="ld-actions">
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/')}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="glass home-form-card ld-card">
      <div className="home-section-title">Approve device link</div>
      <p className="ld-subtitle">
        Scan the QR from your phone camera or enter the fallback code shown on the new device.
      </p>

      {!claim && (
        <form className="ld-code-form" onSubmit={handleResolveCode}>
          <label htmlFor="device-link-code" className="ld-code-label">Link code</label>
          <input
            id="device-link-code"
            className="ld-code-input"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="ABCD1234"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck="false"
          />
          <button type="submit" className="btn btn-secondary" disabled={isResolving}>
            {isResolving ? 'Checking…' : 'Resolve code'}
          </button>
        </form>
      )}

      {claim && (
        <div className="ld-claim-summary">
          <div className="ld-summary-row">
            <span>Device ID</span>
            <strong>{claim.deviceId}</strong>
          </div>
          <div className="ld-summary-row">
            <span>Expires</span>
            <strong>{formatCountdown(claim.expiresAt, now)}</strong>
          </div>
          <div className="ld-summary-row">
            <span>Instance</span>
            <strong>{claim.instanceUrl || window.location.origin}</strong>
          </div>
        </div>
      )}

      {status && <div className="ld-status">{status}</div>}
      {error && <div className="ld-error">{error}</div>}

      <div className="ld-actions">
        {claim && (
          <button type="button" className="btn btn-primary" onClick={handleApprove} disabled={isApproving}>
            {isApproving ? 'Approving…' : 'Approve link'}
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/')}>
          Close
        </button>
      </div>
    </div>
  );
}

export default function LinkDevice() {
  useBodyScrollMode(BODY_SCROLL_MODE.SCROLL);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const isNewDeviceMode = searchParams.get('mode') === 'new';
  const qrPayload = useMemo(() => {
    const encoded = searchParams.get('payload');
    if (!encoded) return null;
    try {
      return decodeQRPayload(encoded);
    } catch {
      return null;
    }
  }, [searchParams]);

  return (
    <div className="home-page ld-page">
      <div className="home-container ld-container">
        {isNewDeviceMode ? (
          <NewDeviceLinkView onLinked={() => navigate('/', { replace: true })} />
        ) : (
          <ApproveLinkView initialPayload={qrPayload} />
        )}

        <div className="ld-footer-link">
          <Link to="/">Return to Hush</Link>
        </div>
      </div>
    </div>
  );
}
