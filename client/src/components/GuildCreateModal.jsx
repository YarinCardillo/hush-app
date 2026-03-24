import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { createGuild, updateGuildMetadata, listServerTemplates } from '../lib/api';
import * as api from '../lib/api';
import * as mlsGroup from '../lib/mlsGroup';
import * as mlsStoreLib from '../lib/mlsStore';
import * as hushCryptoLib from '../lib/hushCrypto';
import { encryptGuildMetadata, toBase64, importMetadataKey } from '../lib/guildMetadata';
import { getDeviceId } from '../hooks/useAuth';
import { useInstanceContext } from '../contexts/InstanceContext';
import modalStyles from './modalStyles';

// ── Instance creation policy annotations ─────────────────────────────────────

/**
 * Maps instance server_creation_policy to { label, disabled, buttonLabel }.
 * @param {string|undefined} policy
 * @returns {{ annotation: string|null, disabled: boolean, buttonLabel: string }}
 */
function getPolicyState(policy) {
  switch (policy) {
    case 'subscribers':
      return {
        annotation: 'Subscription required to create servers.',
        disabled: true,
        buttonLabel: 'Create',
      };
    case 'disabled':
      return {
        annotation: 'Server creation is managed by the instance admin.',
        disabled: true,
        buttonLabel: 'Create',
      };
    case 'request':
      return {
        annotation: 'Your request will be reviewed by the instance admin.',
        disabled: false,
        buttonLabel: 'Request creation',
      };
    case 'open':
    case 'any_member':
    default:
      return { annotation: null, disabled: false, buttonLabel: 'Create' };
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Guild creation modal — server name input, instance picker, template picker.
 *
 * Instance picker is ALWAYS visible (even with one instance) to teach the
 * multi-instance model. Pre-selected to the instance of the currently active
 * guild, or the first connected instance.
 *
 * @param {{
 *   getToken: () => string|null,
 *   onClose: () => void,
 *   onCreated: (guild: object) => void,
 *   activeInstanceUrl?: string|null,
 * }} props
 */
export default function GuildCreateModal({ getToken, onClose, onCreated, activeInstanceUrl }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  // Template picker state
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);

  // ── Instance context ───────────────────────────────────────────────────

  const { instanceStates, refreshGuilds } = useInstanceContext();

  /** List of connected instances sorted by URL for stable display order. */
  const connectedInstances = useMemo(() => {
    const entries = [];
    for (const [url, state] of instanceStates) {
      if (state.connectionState === 'connected') {
        entries.push({ url, state });
      }
    }
    entries.sort((a, b) => a.url.localeCompare(b.url));
    return entries;
  }, [instanceStates]);

  /** Pre-select the active guild's instance, or the first connected instance. */
  const defaultInstanceUrl = activeInstanceUrl ?? connectedInstances[0]?.url ?? null;
  const [selectedInstanceUrl, setSelectedInstanceUrl] = useState(defaultInstanceUrl);

  // Update selected instance when context loads if not yet set.
  useEffect(() => {
    if (!selectedInstanceUrl && connectedInstances.length > 0) {
      setSelectedInstanceUrl(connectedInstances[0].url);
    }
  }, [connectedInstances, selectedInstanceUrl]);

  // Re-derive policy from selected instance's handshake data.
  const selectedHandshake = instanceStates.get(selectedInstanceUrl ?? '')?.handshakeData ?? null;
  const creationPolicy = selectedHandshake?.server_creation_policy ?? selectedHandshake?.server_creation_policy_value ?? null;
  const { annotation, disabled: policyDisabled, buttonLabel } = getPolicyState(creationPolicy);

  // ── Modal lifecycle ────────────────────────────────────────────────────

  useEffect(() => {
    const t = requestAnimationFrame(() => setIsOpen(true));
    return () => cancelAnimationFrame(t);
  }, []);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // ── Load templates for selected instance ──────────────────────────────

  useEffect(() => {
    const effectiveToken = selectedInstanceUrl
      ? (instanceStates.get(selectedInstanceUrl)?.jwt ?? getToken())
      : getToken();
    if (!effectiveToken) return;

    setTemplates([]);
    setSelectedTemplateId(null);
    setTemplatesLoaded(false);

    (async () => {
      try {
        const data = await listServerTemplates(effectiveToken, selectedInstanceUrl ?? undefined);
        if (Array.isArray(data) && data.length > 0) {
          setTemplates(data);
          const def = data.find(t => t.isDefault);
          setSelectedTemplateId(def ? def.id : data[0].id);
        }
      } catch {
        // Templates are optional — server uses its default on failure.
      }
      setTemplatesLoaded(true);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInstanceUrl]);

  // ── MLS deps builder ──────────────────────────────────────────────────

  /**
   * Build the MLS deps object needed by mlsGroup functions.
   * @param {IDBDatabase} db
   * @param {string} token
   * @returns {object}
   */
  const buildMlsDeps = (db, token) => {
    return { db, token, mlsStore: mlsStoreLib, hushCrypto: hushCryptoLib, api };
  };

  // ── Submit ────────────────────────────────────────────────────────────

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Server name is required.');
      return;
    }

    // Use per-instance JWT for the selected instance, fall back to prop getToken().
    const effectiveToken = selectedInstanceUrl
      ? (instanceStates.get(selectedInstanceUrl)?.jwt ?? getToken())
      : getToken();
    const effectiveBaseUrl = selectedInstanceUrl ?? undefined;

    if (!effectiveToken) {
      setError('Not authenticated.');
      return;
    }

    setLoading(true);
    try {
      // Step 1: Create the guild with null encryptedMetadata to get its UUID.
      const guild = await createGuild(effectiveToken, null, selectedTemplateId, effectiveBaseUrl);

      // Step 2: Create the guild metadata MLS group (creator is the sole member).
      let mlsSuccess = false;
      try {
        const db = await mlsStoreLib.openDB(getDeviceId());
        if (db) {
          const credential = await mlsStoreLib.getCredential(db);
          const deps = { ...buildMlsDeps(db, effectiveToken), credential };
          await mlsGroup.createGuildMetadataGroup(deps, guild.id);

          const { metadataKeyBytes } = await mlsGroup.exportGuildMetadataKey(deps, guild.id);
          const symmetricKey = await importMetadataKey(metadataKeyBytes);
          const encBlob = await encryptGuildMetadata(symmetricKey, {
            name: trimmed,
            description: '',
            icon: null,
          });
          const encryptedMetadata = toBase64(encBlob);

          await updateGuildMetadata(effectiveToken, guild.id, encryptedMetadata, effectiveBaseUrl);
          guild.encryptedMetadata = encryptedMetadata;
          mlsSuccess = true;
        }
      } catch (mlsErr) {
        console.warn('[GuildCreateModal] MLS metadata group setup failed:', mlsErr);
      }

      if (!mlsSuccess) {
        guild._localName = trimmed;
      }

      // Step 3: Refresh guild list for the selected instance.
      if (selectedInstanceUrl) {
        refreshGuilds(selectedInstanceUrl).catch(() => {});
      }

      onCreated(guild);
    } catch (err) {
      setError(err.message || 'Failed to create server.');
    } finally {
      setLoading(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────

  return createPortal(
    <div
      className={`modal-backdrop ${isOpen ? 'modal-backdrop-open' : ''}`}
      onClick={onClose}
    >
      <div
        className={`modal-content ${isOpen ? 'modal-content-open' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={modalStyles.title}>Create a server</div>
        <form style={modalStyles.form} onSubmit={handleSubmit}>
          {/* Server name */}
          <div>
            <label htmlFor="guild-name" style={modalStyles.fieldLabel}>Server name</label>
            <input
              id="guild-name"
              name="guild-name"
              className="input"
              type="text"
              placeholder="My server"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              maxLength={100}
              autoComplete="off"
              autoFocus
            />
          </div>

          {/* Instance picker — ALWAYS visible, even with 1 instance */}
          <div>
            <label htmlFor="guild-instance" style={modalStyles.fieldLabel}>Instance</label>
            {connectedInstances.length === 0 ? (
              <div style={{ fontSize: '0.8rem', color: 'var(--hush-text-muted)', padding: '8px 0' }}>
                No instances connected.
              </div>
            ) : (
              <select
                id="guild-instance"
                className="input"
                value={selectedInstanceUrl ?? ''}
                onChange={(e) => setSelectedInstanceUrl(e.target.value || null)}
                style={{ cursor: 'pointer' }}
              >
                {connectedInstances.map(({ url }) => {
                  const host = (() => {
                    try { return new URL(url).host; } catch { return url; }
                  })();
                  return (
                    <option key={url} value={url}>{host}</option>
                  );
                })}
              </select>
            )}
          </div>

          {/* Policy annotation */}
          {annotation && (
            <div style={{
              padding: '8px 12px',
              background: policyDisabled ? 'var(--hush-danger-ghost)' : 'var(--hush-amber-ghost)',
              color: policyDisabled ? 'var(--hush-danger)' : 'var(--hush-amber)',
              fontSize: '0.8rem',
              borderRadius: 0,
            }}>
              {annotation}
            </div>
          )}

          {/* Template picker — only shown when multiple templates exist */}
          {templatesLoaded && templates.length > 1 && (
            <div style={{ marginTop: '4px' }}>
              <label style={modalStyles.fieldLabel}>Template</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                {templates.map(tmpl => (
                  <label
                    key={tmpl.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '8px 10px', borderRadius: 'var(--radius-md)',
                      background: selectedTemplateId === tmpl.id ? 'var(--hush-bg-hover)' : 'transparent',
                      border: selectedTemplateId === tmpl.id ? '1px solid var(--hush-live)' : '1px solid var(--hush-border)',
                      cursor: 'pointer', transition: 'all 0.15s ease',
                    }}
                  >
                    <input
                      type="radio"
                      name="template"
                      value={tmpl.id}
                      checked={selectedTemplateId === tmpl.id}
                      onChange={() => setSelectedTemplateId(tmpl.id)}
                      style={{ accentColor: 'var(--hush-live)' }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: '0.85rem', color: 'var(--hush-text-primary)' }}>
                        {tmpl.name}
                        {tmpl.isDefault && <span style={{ fontSize: '0.7rem', color: 'var(--hush-text-ghost)', marginLeft: '6px' }}>(default)</span>}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--hush-text-ghost)' }}>
                        {tmpl.channels.filter(c => c.type !== 'system').map(c => c.type === 'voice' ? `${c.name} (voice)` : `#${c.name}`).join(', ') || 'system only'}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && <div style={modalStyles.error}>{error}</div>}
          <div style={modalStyles.actions}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !name.trim() || policyDisabled || connectedInstances.length === 0}
            >
              {loading ? 'Creating\u2026' : buttonLabel}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
