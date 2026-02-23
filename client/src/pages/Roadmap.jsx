import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { milestones, releases } from '../data/changelog.js';

/* ── Status config ── */

const STATUS = {
  done:    { label: 'shipped',     color: 'var(--hush-live)',       bg: 'var(--hush-live-glow)' },
  active:  { label: 'in progress', color: 'var(--hush-amber)',      bg: 'var(--hush-amber-ghost)' },
  planned: { label: 'planned',     color: 'var(--hush-text-muted)', bg: 'var(--hush-elevated)' },
  future:  { label: 'future',      color: 'var(--hush-text-ghost)', bg: 'var(--hush-elevated)' },
};

const TAG_STYLE = {
  release:  { color: 'var(--hush-amber)',  bg: 'var(--hush-amber-ghost)' },
  fix:      { color: 'var(--hush-live)',    bg: 'var(--hush-live-glow)' },
  security: { color: 'var(--hush-danger)',  bg: 'var(--hush-danger-ghost)' },
  breaking: { color: 'var(--hush-danger)',  bg: 'var(--hush-danger-ghost)' },
};

/* ── Derived data ── */

const STATUS_CLASS = { done: 'shipped', active: 'progress', planned: 'planned', future: 'future' };
const BADGE_CLASS  = { done: 'badge-shipped', active: 'badge-progress', planned: 'badge-planned', future: 'badge-future' };

const shippedOrActive = milestones.filter((m) => m.status === 'done' || m.status === 'active');
const plannedOrFuture = milestones.filter((m) => m.status === 'planned' || m.status === 'future');

/** Milestones rendered in the main timeline: newest first (reverse chronological). */
const timelineMilestones = [...shippedOrActive].reverse();

/**
 * "What's next" milestones: reversed so furthest future is at top,
 * nearest planned at bottom (reading top-down = far future to near future).
 */
const whatsNextMilestones = [...plannedOrFuture].reverse();

/** Map milestone ID to its releases (preserves source order: newest first). */
function releasesForMilestone(milestoneId) {
  return releases.filter((r) => r.milestone === milestoneId);
}

/* ── Helpers ── */

/** Format ISO date string to readable short form (e.g. "23 feb 2026"). */
function formatDate(iso) {
  const d = new Date(iso);
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/* ── Chevron SVG ── */

function Chevron() {
  return (
    <svg className="release-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

/* ── Styles ── */

const styles = `
  /* ── PAGE ── */
  .roadmap-page {
    max-width: 700px;
    margin: 0 auto;
    padding: 72px 40px 120px;
    font-family: var(--font-sans);
    color: var(--hush-text);
    -webkit-font-smoothing: antialiased;
  }

  .roadmap-back {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--hush-text-muted);
    text-decoration: none;
    letter-spacing: 0.05em;
    display: inline-block;
    margin-bottom: 32px;
    transition: color 200ms var(--ease-out);
  }
  .roadmap-back:hover { color: var(--hush-amber); }

  .page-eyebrow {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--hush-amber);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin-bottom: 12px;
  }
  .page-title {
    font-size: 2rem;
    font-weight: 300;
    letter-spacing: -0.03em;
    margin-bottom: 8px;
  }
  .page-sub {
    font-size: 0.9rem;
    color: var(--hush-text-secondary);
    line-height: 1.6;
    margin-bottom: 40px;
  }

  /* ── LEGEND ── */
  .rm-legend {
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
    margin-bottom: 64px;
  }
  .rm-legend-item {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 0.7rem;
    font-weight: 500;
    color: var(--hush-text-muted);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .rm-legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .dot-shipped  { background: var(--hush-live); }
  .dot-progress { background: var(--hush-amber); }
  .dot-planned  { background: var(--hush-border-focus); border: 1px solid var(--hush-border-focus); }
  .dot-future   { background: transparent; border: 1px solid var(--hush-text-ghost); }

  /* ── WHAT'S NEXT ACCORDION ── */
  .whats-next { margin-bottom: 40px; }

  .whats-next-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: var(--hush-surface);
    border: 1px solid transparent;
    border-radius: 0;
    cursor: pointer;
    color: var(--hush-text);
    font-family: var(--font-sans);
    font-size: 0.85rem;
    font-weight: 500;
    transition: background 120ms var(--ease-out);
  }
  .whats-next-toggle:hover { background: var(--hush-elevated); }

  .whats-next-count {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    font-weight: 500;
    color: var(--hush-text-muted);
    letter-spacing: 0.08em;
    padding: 1px 7px;
    background: var(--hush-elevated);
  }

  .whats-next-chevron {
    margin-left: auto;
    color: var(--hush-text-ghost);
    transition: transform 200ms var(--ease-out);
    flex-shrink: 0;
  }
  .whats-next.open .whats-next-chevron { transform: rotate(90deg); }

  .whats-next-body {
    display: none;
    padding-top: 4px;
  }
  .whats-next.open .whats-next-body { display: block; }

  /* ── TIMELINE ── */
  .rm-timeline {
    position: relative;
    display: flex;
    flex-direction: column;
  }
  .rm-timeline::before {
    content: '';
    position: absolute;
    left: 7px;
    top: 10px;
    bottom: 10px;
    width: 1px;
    background: var(--hush-border);
    z-index: 0;
  }

  /* ── MILESTONE ── */
  .rm-milestone {
    position: relative;
    padding-left: 36px;
    margin-bottom: 4px;
  }
  .rm-milestone-dot {
    position: absolute;
    left: 0;
    top: 12px;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    border: 1px solid var(--hush-border-hover);
    background: var(--hush-black);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1;
  }
  .rm-milestone-dot-inner {
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }
  .rm-milestone.shipped .rm-milestone-dot-inner  { background: var(--hush-live); box-shadow: 0 0 6px var(--hush-live-glow); }
  .rm-milestone.progress .rm-milestone-dot-inner { background: var(--hush-amber); box-shadow: 0 0 6px var(--hush-amber-glow); }
  .rm-milestone.planned .rm-milestone-dot-inner  { background: var(--hush-border-focus); }
  .rm-milestone.future .rm-milestone-dot-inner   { background: transparent; border: 1px solid var(--hush-text-ghost); }

  .rm-milestone-card {
    background: var(--hush-surface);
    padding: 20px 24px;
    margin-bottom: 2px;
    border: 1px solid transparent;
    border-radius: 0;
  }
  .rm-milestone.planned .rm-milestone-card,
  .rm-milestone.future  .rm-milestone-card { opacity: 0.55; }

  .rm-milestone-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
  }
  .rm-milestone-id {
    font-size: 0.65rem;
    font-weight: 600;
    color: var(--hush-text-muted);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .rm-milestone-badge {
    font-size: 0.65rem;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: 0;
  }
  .badge-shipped  { color: var(--hush-live);        background: var(--hush-live-glow); }
  .badge-progress { color: var(--hush-amber);       background: var(--hush-amber-ghost); border: 1px solid var(--hush-amber-dim); }
  .badge-planned  { color: var(--hush-text-muted);  background: var(--hush-elevated); }
  .badge-future   { color: var(--hush-text-ghost);  background: var(--hush-elevated); }

  .rm-milestone-title {
    font-size: 1.1rem;
    font-weight: 300;
    letter-spacing: -0.02em;
    margin-top: 8px;
    margin-bottom: 6px;
  }
  .rm-milestone-desc {
    font-size: 0.85rem;
    color: var(--hush-text-secondary);
    line-height: 1.55;
  }

  /* ── RELEASES ── */
  .rm-releases {
    padding-left: 36px;
    margin-bottom: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .rm-release { position: relative; }

  .rm-release-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    background: transparent;
    border: none;
    border-radius: 0;
    cursor: pointer;
    text-align: left;
    transition: background 120ms;
    color: var(--hush-text);
    font-family: var(--font-sans);
    position: relative;
  }
  .rm-release-toggle:hover { background: var(--hush-surface); }
  .rm-release-toggle:hover .release-chevron { color: var(--hush-text-secondary); }
  .rm-release-toggle:hover .rm-release-title { color: var(--hush-text); }

  .rm-release-dot {
    position: absolute;
    left: -23px;
    top: 50%;
    transform: translateY(-50%);
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--hush-border-focus);
    border: 1px solid var(--hush-border-hover);
    flex-shrink: 0;
    z-index: 1;
  }
  .rm-release.current .rm-release-dot {
    background: var(--hush-amber);
    border-color: var(--hush-amber);
    box-shadow: 0 0 0 3px var(--hush-amber-ghost);
    animation: hush-pulse 2s ease-in-out infinite;
  }

  .rm-release-version {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--hush-text);
    min-width: 110px;
  }
  .rm-release.current .rm-release-version { color: var(--hush-amber); }

  .rm-release-date {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--hush-text-muted);
    min-width: 80px;
  }

  .rm-release-title {
    font-size: 0.85rem;
    color: var(--hush-text-secondary);
    flex: 1;
    transition: color 120ms;
  }

  .rm-release-tags {
    display: flex;
    gap: 6px;
  }
  .rm-release-tag {
    font-size: 0.6rem;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 1px 6px;
    border-radius: 0;
  }

  .rm-current-pill {
    font-size: 0.6rem;
    font-weight: 500;
    color: var(--hush-amber);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 1px 7px;
    background: var(--hush-amber-ghost);
    border: 1px solid var(--hush-amber-dim);
    border-radius: 0;
  }

  .release-chevron {
    color: var(--hush-text-ghost);
    transition: transform 200ms var(--ease-out), color 120ms;
    flex-shrink: 0;
  }
  .rm-release.open .release-chevron { transform: rotate(90deg); }

  /* ── RELEASE BODY ── */
  .rm-release-body {
    display: none;
    padding: 0 16px 12px 16px;
    background: var(--hush-surface);
    border-top: 1px solid var(--hush-border);
  }
  .rm-release.open .rm-release-body { display: block; }
  .rm-release.open .rm-release-toggle { background: var(--hush-surface); }

  .rm-change-group { margin-top: 16px; }
  .rm-change-group:first-child { margin-top: 12px; }

  .rm-change-group-label {
    font-size: 0.65rem;
    font-weight: 600;
    color: var(--hush-text-muted);
    letter-spacing: 0.09em;
    text-transform: uppercase;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .rm-change-group-label::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--hush-border);
  }

  .rm-change-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .rm-change-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 0.82rem;
    color: var(--hush-text-secondary);
    line-height: 1.5;
  }
  .rm-change-item::before {
    content: '\\2014';
    color: var(--hush-text-ghost);
    flex-shrink: 0;
    font-size: 0.75rem;
    margin-top: 1px;
  }

  /* ── PROGRESS NOTE ── */
  .rm-progress-note {
    padding-left: 36px;
    margin-bottom: 4px;
  }
  .rm-progress-note-inner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    background: var(--hush-amber-ghost);
    border-left: 2px solid var(--hush-amber-dim);
    border-radius: 0;
  }
  .rm-progress-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--hush-amber);
    animation: hush-pulse 2s ease-in-out infinite;
    flex-shrink: 0;
  }
  .rm-progress-note-text {
    font-size: 0.8rem;
    color: var(--hush-amber);
    font-weight: 400;
  }

  /* ── SPACER ── */
  .rm-spacer { height: 28px; }

  /* ── FOOTER ── */
  .rm-footer {
    margin-top: 96px;
    padding-top: 32px;
    border-top: 1px solid var(--hush-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
  }
  .rm-footer-text {
    font-size: 0.75rem;
    color: var(--hush-text-muted);
  }
  .rm-footer-links {
    display: flex;
    gap: 24px;
  }
  .rm-footer-link {
    color: var(--hush-amber);
    text-decoration: none;
    font-size: 0.75rem;
    font-weight: 500;
    transition: color 120ms;
  }
  .rm-footer-link:hover { color: var(--hush-amber-bright); }

  /* ── ANIMATIONS ── */
  @keyframes hush-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.4; }
  }
  @keyframes fade-up {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .rm-milestone, .rm-releases, .rm-progress-note {
    animation: fade-up 0.35s var(--ease-out) both;
  }

  /* ── RESPONSIVE ── */
  @media (max-width: 640px) {
    .roadmap-page { padding: 40px 16px 64px; }
    .page-title { font-size: 1.4rem; }
    .rm-legend { gap: 12px; }
    .rm-release-version { min-width: 80px; }
    .rm-release-date { display: none; }
  }
`;

/* ── Component ── */

export default function Roadmap() {
  const [openReleases, setOpenReleases] = useState(new Set());
  const [whatsNextOpen, setWhatsNextOpen] = useState(false);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    const prev = {
      html: { overflow: html.style.overflow, height: html.style.height },
      body: { overflow: body.style.overflow, height: body.style.height },
      root: root ? { overflow: root.style.overflow, height: root.style.height } : null,
    };
    html.style.overflow = 'auto';
    html.style.height = 'auto';
    body.style.overflow = 'auto';
    body.style.height = 'auto';
    if (root) {
      root.style.overflow = 'auto';
      root.style.height = 'auto';
    }
    return () => {
      html.style.overflow = prev.html.overflow;
      html.style.height = prev.html.height;
      body.style.overflow = prev.body.overflow;
      body.style.height = prev.body.height;
      if (root) {
        root.style.overflow = prev.root.overflow;
        root.style.height = prev.root.height;
      }
    };
  }, []);

  function toggleRelease(version) {
    setOpenReleases((prev) => {
      const next = new Set(prev);
      if (next.has(version)) {
        next.delete(version);
      } else {
        next.add(version);
      }
      return next;
    });
  }

  function renderMilestoneCard(m) {
    const cls = STATUS_CLASS[m.status];
    const badge = BADGE_CLASS[m.status];
    const s = STATUS[m.status];

    return (
      <div className={`rm-milestone ${cls}`} key={m.id}>
        <div className="rm-milestone-dot">
          <div className="rm-milestone-dot-inner" />
        </div>
        <div className="rm-milestone-card">
          <div className="rm-milestone-header">
            <span className="rm-milestone-id">Milestone {m.id}</span>
            <span className={`rm-milestone-badge ${badge}`}>{s.label}</span>
          </div>
          <div className="rm-milestone-title">{m.title}</div>
          <div className="rm-milestone-desc">{m.summary}</div>
        </div>
      </div>
    );
  }

  function renderRelease(r) {
    const isOpen = openReleases.has(r.version);
    const isCurrent = r.current === true;
    const releaseClass = [
      'rm-release',
      isOpen ? 'open' : '',
      isCurrent ? 'current' : '',
    ].filter(Boolean).join(' ');

    return (
      <div className={releaseClass} key={r.version}>
        <button
          className="rm-release-toggle"
          onClick={() => toggleRelease(r.version)}
          type="button"
        >
          <span className="rm-release-dot" />
          <span className="rm-release-version">v{r.version}</span>
          <span className="rm-release-date">{formatDate(r.date)}</span>
          <span className="rm-release-title">{r.title}</span>
          <div className="rm-release-tags">
            {r.tags.map((tag) => {
              const ts = TAG_STYLE[tag];
              return (
                <span
                  className="rm-release-tag"
                  key={tag}
                  style={ts ? { color: ts.color, background: ts.bg } : undefined}
                >
                  {tag}
                </span>
              );
            })}
          </div>
          {isCurrent && <span className="rm-current-pill">current</span>}
          <Chevron />
        </button>

        <div className="rm-release-body">
          {r.groups.map((g) => (
            <div className="rm-change-group" key={g.label}>
              <div className="rm-change-group-label">{g.label}</div>
              <ul className="rm-change-list">
                {g.items.map((item, i) => (
                  <li className="rm-change-item" key={i}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderReleases(milestoneId) {
    const rels = releasesForMilestone(milestoneId);
    if (rels.length === 0) return null;
    return (
      <div className="rm-releases">
        {rels.map(renderRelease)}
      </div>
    );
  }

  return (
    <>
      <style>{styles}</style>
      <div className="roadmap-page">

        {/* Back link */}
        <Link to="/" className="roadmap-back">&larr; hush</Link>

        {/* Header */}
        <p className="page-eyebrow">gethush.live</p>
        <h1 className="page-title">product roadmap</h1>
        <p className="page-sub">
          E2EE communication built on Signal Protocol + LiveKit.<br />
          Open source, self-hostable, no tracking.
        </p>

        {/* Legend */}
        <div className="rm-legend">
          <div className="rm-legend-item"><div className="rm-legend-dot dot-shipped" /> shipped</div>
          <div className="rm-legend-item"><div className="rm-legend-dot dot-progress" /> in progress</div>
          <div className="rm-legend-item"><div className="rm-legend-dot dot-planned" /> planned</div>
          <div className="rm-legend-item"><div className="rm-legend-dot dot-future" /> future</div>
        </div>

        {/* What's next accordion */}
        {plannedOrFuture.length > 0 && (
          <div className={`whats-next ${whatsNextOpen ? 'open' : ''}`}>
            <button
              className="whats-next-toggle"
              onClick={() => setWhatsNextOpen((v) => !v)}
              type="button"
            >
              <span>what&rsquo;s next</span>
              <span className="whats-next-count">{plannedOrFuture.length}</span>
              <svg className="whats-next-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            <div className="whats-next-body">
              <div className="rm-timeline">
                {whatsNextMilestones.map((m, i) => (
                  <div key={m.id}>
                    {renderMilestoneCard(m)}
                    {i < whatsNextMilestones.length - 1 && <div className="rm-spacer" />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Main timeline */}
        <div className="rm-timeline">
          {timelineMilestones.map((m, i) => (
            <div key={m.id}>
              {renderMilestoneCard(m)}
              {renderReleases(m.id)}

              {/* Progress note after the active milestone's releases */}
              {m.status === 'active' && (
                <div className="rm-progress-note">
                  <div className="rm-progress-note-inner">
                    <div className="rm-progress-dot" />
                    <span className="rm-progress-note-text">
                      milestone {m.id} in progress — more releases incoming
                    </span>
                  </div>
                </div>
              )}

              {i < timelineMilestones.length - 1 && <div className="rm-spacer" />}
            </div>
          ))}
        </div>

        {/* Footer */}
        <footer className="rm-footer">
          <span className="rm-footer-text">hush is open source and self-hostable.</span>
          <div className="rm-footer-links">
            <a className="rm-footer-link" href="https://github.com/YarinCardillo/hush-app" target="_blank" rel="noopener noreferrer">github</a>
            <a className="rm-footer-link" href="https://github.com/YarinCardillo/hush-app/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer">raw changelog</a>
          </div>
        </footer>

      </div>
    </>
  );
}
