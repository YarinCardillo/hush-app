import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { milestones, releases } from '../data/changelog.js';

/* ── Status config ── */

const STATUS = {
  done:    { label: 'shipped',     color: 'var(--rm-green)',   bg: 'var(--rm-green-ghost)' },
  active:  { label: 'in progress', color: 'var(--rm-blue)',    bg: 'var(--rm-blue-ghost)' },
  planned: { label: 'planned',     color: 'var(--rm-purple)',  bg: 'var(--rm-purple-ghost)' },
  future:  { label: 'future',      color: 'var(--hush-text-ghost)', bg: 'var(--hush-elevated)' },
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
  /* ── Roadmap-scoped status colors (match original palette) ── */
  .roadmap-page {
    --rm-green:        #4ade80;
    --rm-green-ghost:  rgba(74, 222, 128, 0.08);
    --rm-green-glow:   rgba(74, 222, 128, 0.4);
    --rm-blue:         #38bdf8;
    --rm-blue-ghost:   rgba(56, 189, 248, 0.08);
    --rm-blue-glow:    rgba(56, 189, 248, 0.6);
    --rm-blue-border:  rgba(56, 189, 248, 0.33);
    --rm-purple:       #a78bfa;
    --rm-purple-ghost: rgba(167, 139, 250, 0.08);
    --rm-purple-border:rgba(167, 139, 250, 0.33);
  }

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
  .dot-shipped  { background: var(--rm-green); }
  .dot-progress { background: var(--rm-blue); }
  .dot-planned  { background: var(--rm-purple); }
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
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
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
  .rm-milestone.shipped .rm-milestone-dot-inner  { background: var(--rm-green); box-shadow: 0 0 6px var(--rm-green-glow); }
  .rm-milestone.progress .rm-milestone-dot-inner { background: var(--rm-blue); box-shadow: 0 0 8px var(--rm-blue-glow); animation: roadmap-pulse 2s ease-in-out infinite; }
  .rm-milestone.planned .rm-milestone-dot-inner  { background: transparent; border-color: var(--rm-purple); }
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
  .badge-shipped  { color: var(--rm-green);   background: var(--rm-green-ghost); }
  .badge-progress { color: var(--rm-blue);    background: var(--rm-blue-ghost); border: 1px solid var(--rm-blue-border); }
  .badge-planned  { color: var(--rm-purple);  background: var(--rm-purple-ghost); border: 1px solid var(--rm-purple-border); }
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
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
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
    background: var(--rm-blue);
    border-color: var(--rm-blue);
    box-shadow: 0 0 0 3px var(--rm-blue-ghost);
    animation: hush-pulse 2s ease-in-out infinite;
  }

  .rm-release-version {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--hush-text);
    min-width: 110px;
  }
  .rm-release.current .rm-release-version { color: var(--rm-blue); }

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
  /* ── ANIMATIONS ── */
  @keyframes hush-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%      { opacity: 0.4; transform: scale(0.85); }
  }
  @keyframes roadmap-pulse {
    0%, 100% { box-shadow: 0 0 8px var(--rm-blue-glow); }
    50%      { box-shadow: 0 0 16px var(--rm-blue-glow), 0 0 32px rgba(56, 189, 248, 0.2); }
  }
  @keyframes fade-up {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .rm-milestone, .rm-releases {
    animation: fade-up 0.35s var(--ease-out) both;
  }

  /* ── RESPONSIVE ── */
  @media (max-width: 640px) {
    .roadmap-page { padding: 40px 16px 64px; }
    .page-title { font-size: 1.4rem; }
    .rm-legend { gap: 12px; }
    .rm-release-date { display: none; }

    /* Release toggle: wrap version+tags row, title on its own line below */
    .rm-release-toggle { flex-wrap: wrap; row-gap: 4px; }
    .rm-release-version { min-width: 0; }
    .rm-release-title { order: 10; flex: 0 0 100%; padding-left: 0; }
    .release-chevron { margin-left: auto; }
  }

  /* ── HOVER (pointer devices only — fix sticky hover on touch) ── */
  @media (hover: hover) {
    .roadmap-back:hover { color: var(--hush-amber); }
    .whats-next-toggle:hover { background: var(--hush-elevated); }
    .rm-release-toggle:hover { background: var(--hush-surface); }
    .rm-release-toggle:hover .release-chevron { color: var(--hush-text-secondary); }
    .rm-release-toggle:hover .rm-release-title { color: var(--hush-text); }
    .rm-footer-link:hover { color: var(--hush-amber-bright); }
  }
`;

/* ── Sub-components ── */

function MilestoneCard({ milestone }) {
  const cls = STATUS_CLASS[milestone.status];
  const badge = BADGE_CLASS[milestone.status];
  const s = STATUS[milestone.status];

  return (
    <div className={`rm-milestone ${cls}`}>
      <div className="rm-milestone-dot">
        <div className="rm-milestone-dot-inner" />
      </div>
      <div className="rm-milestone-card">
        <div className="rm-milestone-header">
          <span className="rm-milestone-id">Milestone {milestone.id}</span>
          <span className={`rm-milestone-badge ${badge}`}>{s.label}</span>
        </div>
        <div className="rm-milestone-title">{milestone.title}</div>
        <div className="rm-milestone-desc">{milestone.summary}</div>
      </div>
    </div>
  );
}

function ReleaseEntry({ release, isOpen, onToggle }) {
  const isCurrent = release.current === true;
  const releaseClass = [
    'rm-release',
    isOpen ? 'open' : '',
    isCurrent ? 'current' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={releaseClass}>
      <button
        className="rm-release-toggle"
        onClick={() => onToggle(release.version)}
        type="button"
      >
        <span className="rm-release-dot" />
        <span className="rm-release-version">v{release.version}</span>
        <span className="rm-release-date">{formatDate(release.date)}</span>
        <span className="rm-release-title">{release.title}</span>
        <Chevron />
      </button>

      <div className="rm-release-body">
        {release.groups.map((g) => (
          <div className="rm-change-group" key={g.label}>
            <div className="rm-change-group-label">{g.label}</div>
            <ul className="rm-change-list">
              {g.items.map((item) => (
                <li className="rm-change-item" key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Main component ── */

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
                    <MilestoneCard milestone={m} />
                    {i < whatsNextMilestones.length - 1 && <div className="rm-spacer" />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Main timeline */}
        <div className="rm-timeline">
          {timelineMilestones.map((m, i) => {
            const rels = releasesForMilestone(m.id);
            return (
              <div key={m.id}>
                <MilestoneCard milestone={m} />
                {rels.length > 0 && (
                  <div className="rm-releases">
                    {rels.map((r) => (
                      <ReleaseEntry
                        key={r.version}
                        release={r}
                        isOpen={openReleases.has(r.version)}
                        onToggle={toggleRelease}
                      />
                    ))}
                  </div>
                )}


                {i < timelineMilestones.length - 1 && <div className="rm-spacer" />}
              </div>
            );
          })}
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
