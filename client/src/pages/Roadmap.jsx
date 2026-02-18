import { useState, useEffect } from "react";
import { Link } from "react-router-dom";

const milestones = [
  {
    id: "A",
    label: "Milestone A",
    title: "Matrix Foundation",
    status: "done",
    summary: "Auth + persistent chat via Matrix. mediasoup still handling media.",
    tasks: [
      "Synapse + PostgreSQL in docker-compose",
      "Reverse proxy (Caddy) routing /_matrix/ and /",
      "matrix-js-sdk client with login / register / guest",
      "Persistent chat via Matrix room timeline",
      "Bridge layer for Socket.io continuity",
    ],
  },
  {
    id: "B",
    label: "Milestone B",
    title: "LiveKit Migration",
    status: "done",
    summary: "mediasoup replaced with LiveKit. Socket.io gone. Media works, E2EE not yet.",
    tasks: [
      "LiveKit Server + Redis in docker-compose",
      "Custom token service: Matrix token → LiveKit JWT",
      "useRoom.js replacing useMediasoup.js (1141 lines)",
      "Noise gate AudioWorklet preserved in new pipeline",
      "Server thinned: static files + token service only",
    ],
  },
  {
    id: "B2",
    label: "Milestone B2",
    title: "Full E2EE",
    status: "done",
    summary: "End-to-end encryption on both chat (Matrix/Megolm) and media (LiveKit/AES-GCM).",
    tasks: [
      "initRustCrypto(): vodozemac via WASM, no libolm",
      "Auth persistence across refresh via sessionStorage",
      "Matrix token validation in token service (401 on missing)",
      "Random E2EE key + Olm to-device distribution",
      "Leader election for rekeying on participant leave",
      "Media controls disabled on E2EE init failure",
      "SECURITY.md documenting threat model",
    ],
  },
  {
    id: "C",
    label: "Milestone C",
    title: "Discord-Like UX",
    status: "active",
    summary: "Spaces as servers, rooms as channels. Full community structure on Matrix.",
    tasks: [
      "Matrix Spaces → Hush Servers",
      "Text channels (Matrix rooms, E2EE)",
      "Voice channels (Matrix rooms + LiveKit call state)",
      "Server list sidebar, channel list, member list",
      "Invite links via Matrix room aliases",
      "Moderation via Matrix power levels (0 / 50 / 100)",
    ],
  },
  {
    id: "D",
    label: "Milestone D",
    title: "Production & Hosted",
    status: "planned",
    summary: "Hosted instance live. Self-hosting guide. Federation.",
    tasks: [
      "hosted/ directory: hosted-specific logic isolated from core",
      "Token service: configurable limits (participants, features)",
      "LiveKit Cloud option for hosted deploy",
      "scripts/setup.sh and self-hosting docs",
      "Federation via Synapse .well-known config",
      "Code quality and security audit",
    ],
  },
  {
    id: "E",
    label: "Milestone E",
    title: "Key Backup & Device Verification",
    status: "future",
    summary: "Losing browser data no longer means losing history.",
    tasks: [
      "SSSS (Secure Secret Storage and Sharing)",
      "Cross-signing: verify once, trusted everywhere",
      "Emoji / QR code device verification UI",
      "Key backup to Synapse (encrypted, user passphrase)",
    ],
  },
  {
    id: "F",
    label: "Milestone F",
    title: "Mobile & Desktop",
    status: "future",
    summary: "Native apps for mobile and desktop.",
    tasks: [
      "React Native or Flutter mobile client",
      "Electron or Tauri desktop client",
      "Push notifications via Matrix push gateway (Sygnal)",
      "Background audio for voice channels",
    ],
  },
];

const STATUS = {
  done: { label: "SHIPPED", color: "#4ade80", bg: "rgba(74,222,128,0.08)", border: "rgba(74,222,128,0.33)", dot: "#4ade80" },
  active: { label: "IN PROGRESS", color: "#38bdf8", bg: "rgba(56,189,248,0.08)", border: "rgba(56,189,248,0.33)", dot: "#38bdf8" },
  planned: { label: "PLANNED", color: "#a78bfa", bg: "rgba(167,139,250,0.08)", border: "rgba(167,139,250,0.33)", dot: "#a78bfa" },
  future: { label: "FUTURE", color: "#64748b", bg: "rgba(100,116,139,0.06)", border: "var(--hush-border)", dot: "#475569" },
};

const styles = `
  * { box-sizing: border-box; margin: 0; padding: 0; }

  .roadmap-root {
    min-height: 100vh;
    background: transparent;
    color: var(--hush-text);
    font-family: var(--font-sans);
    padding: 64px 24px 96px;
    position: relative;
    overflow-x: hidden;
    user-select: none;
    z-index: 1;
  }

  .container {
    max-width: 760px;
    margin: 0 auto;
    position: relative;
  }

  .header {
    margin-bottom: 64px;
  }

  .eyebrow {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.15em;
    color: var(--hush-amber);
    text-transform: uppercase;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .eyebrow::before {
    content: '';
    display: block;
    width: 24px;
    height: 1px;
    background: var(--hush-amber);
    opacity: 0.6;
  }

  .back-link {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--hush-text-muted);
    text-decoration: none;
    letter-spacing: 0.05em;
    margin-bottom: 24px;
    display: inline-block;
    transition: color 0.2s;
  }

  .back-link:hover {
    color: var(--hush-amber);
  }

  .roadmap-root h1 {
    font-family: var(--font-mono);
    font-size: clamp(28px, 5vw, 42px);
    font-weight: 600;
    color: var(--hush-text);
    line-height: 1.1;
    letter-spacing: -0.02em;
    margin-bottom: 16px;
  }

  .subtitle {
    font-size: 15px;
    color: var(--hush-text-secondary);
    font-weight: 300;
    line-height: 1.6;
    max-width: 480px;
  }

  .legend {
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
    margin-top: 32px;
    padding-top: 24px;
    border-top: 1px solid var(--hush-border);
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 7px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    color: var(--hush-text-muted);
  }

  .legend-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .timeline {
    position: relative;
  }

  .timeline-line {
    position: absolute;
    left: 19.5px;
    top: 0;
    bottom: 0;
    width: 1px;
    background: linear-gradient(
      to bottom,
      transparent 0%,
      var(--hush-border) 5%,
      var(--hush-border) 95%,
      transparent 100%
    );
  }

  .milestone {
    display: flex;
    gap: 24px;
    margin-bottom: 8px;
    position: relative;
  }

  .milestone-dot-col {
    flex-shrink: 0;
    width: 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: 18px;
  }

  .milestone-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1px solid;
    position: relative;
    z-index: 1;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    flex-shrink: 0;
  }

  .milestone-dot.done {
    background: #4ade80;
    border-color: #4ade80;
    box-shadow: 0 0 8px rgba(74,222,128,0.4);
  }

  .milestone-dot.active {
    background: #38bdf8;
    border-color: #38bdf8;
    box-shadow: 0 0 12px rgba(56,189,248,0.6);
    animation: roadmap-pulse 2s ease-in-out infinite;
  }

  .milestone-dot.planned {
    background: transparent;
    border-color: #a78bfa;
  }

  .milestone-dot.future {
    background: transparent;
    border-color: var(--hush-text-ghost);
  }

  @keyframes roadmap-pulse {
    0%, 100% { box-shadow: 0 0 8px rgba(56,189,248,0.4); }
    50% { box-shadow: 0 0 16px rgba(56,189,248,0.8), 0 0 32px rgba(56,189,248,0.2); }
  }

  .milestone-card {
    flex: 1;
    border: 1px solid var(--hush-border);
    border-radius: var(--radius-sm);
    padding: 18px 20px;
    cursor: pointer;
    transition: border-color 0.2s ease, background 0.2s ease;
    margin-bottom: 12px;
    background: var(--hush-surface);
    user-select: none;
  }

  .milestone-card:hover {
    border-color: var(--hush-border-hover);
    background: var(--hush-elevated);
  }

  .milestone-card.open {
    border-color: var(--hush-border-hover);
    background: var(--hush-elevated);
  }

  .card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .card-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
  }

  .milestone-id {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--hush-text-ghost);
    letter-spacing: 0.08em;
  }

  .status-badge {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 500;
    letter-spacing: 0.12em;
    padding: 2px 7px;
    border-radius: 3px;
    border: 1px solid;
  }

  .card-title {
    font-size: 15px;
    font-weight: 500;
    color: var(--hush-text);
    letter-spacing: -0.01em;
    line-height: 1.3;
  }

  .card-summary {
    font-size: 13px;
    color: var(--hush-text-secondary);
    line-height: 1.6;
    margin-top: 8px;
    font-weight: 300;
  }

  .chevron {
    color: var(--hush-text-ghost);
    font-size: 12px;
    transition: transform 0.2s ease, color 0.2s ease;
    flex-shrink: 0;
    margin-top: 2px;
    font-family: var(--font-mono);
  }

  .chevron.open {
    transform: rotate(90deg);
    color: var(--hush-text-muted);
  }

  .tasks {
    overflow: hidden;
    max-height: 0;
    transition: max-height 0.3s ease, opacity 0.3s ease;
    opacity: 0;
  }

  .tasks.open {
    max-height: 400px;
    opacity: 1;
  }

  .tasks-inner {
    padding-top: 16px;
    border-top: 1px solid var(--hush-border);
    margin-top: 14px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .task-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--hush-text-secondary);
    line-height: 1.5;
  }

  .task-check {
    flex-shrink: 0;
    margin-top: 1px;
    font-size: 10px;
  }

  .footer-note {
    margin-top: 56px;
    padding-top: 24px;
    border-top: 1px solid var(--hush-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: gap;
    gap: 12px;
  }

  .footer-text {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--hush-text-ghost);
    letter-spacing: 0.05em;
  }

  .footer-link {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--hush-text-muted);
    text-decoration: none;
    letter-spacing: 0.05em;
    transition: color 0.2s;
  }

  .footer-link:hover {
    color: var(--hush-amber);
  }

  @media (max-width: 520px) {
    .roadmap-root { padding: 40px 16px 64px; }
    h1 { font-size: 26px; }
    .legend { gap: 14px; }
  }
`;

export default function Roadmap() {
  const [open, setOpen] = useState(null);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById("root");
    const prev = {
      html: { overflow: html.style.overflow, height: html.style.height },
      body: { overflow: body.style.overflow, height: body.style.height },
      root: root ? { overflow: root.style.overflow, height: root.style.height } : null,
    };
    html.style.overflow = "auto";
    html.style.height = "auto";
    body.style.overflow = "auto";
    body.style.height = "auto";
    if (root) {
      root.style.overflow = "auto";
      root.style.height = "auto";
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

  const toggle = (id) => setOpen((prev) => (prev === id ? null : id));

  return (
    <>
      <style>{styles}</style>
      <div className="roadmap-root">
        <div className="container">

          <div className="header">
            <Link to="/" className="back-link">← Hush</Link>
            <div className="eyebrow">gethush.live</div>
            <h1>Product Roadmap</h1>
            <p className="subtitle">
              E2EE communication built on Matrix + LiveKit.
              Open source, self-hostable, no tracking.
            </p>
            <div className="legend">
              {Object.entries(STATUS).map(([key, s]) => (
                <div className="legend-item" key={key}>
                  <div className="legend-dot" style={{ background: s.dot }} />
                  {s.label}
                </div>
              ))}
            </div>
          </div>

          <div className="timeline">
            <div className="timeline-line" />

            {milestones.map((m) => {
              const s = STATUS[m.status];
              const isOpen = open === m.id;

              return (
                <div className="milestone" key={m.id}>
                  <div className="milestone-dot-col">
                    <div className={`milestone-dot ${m.status}`} />
                  </div>

                  <div
                    className={`milestone-card ${isOpen ? "open" : ""}`}
                    onClick={() => toggle(m.id)}
                  >
                    <div className="card-header">
                      <div style={{ flex: 1 }}>
                        <div className="card-meta">
                          <span className="milestone-id">{m.label}</span>
                          <span
                            className="status-badge"
                            style={{
                              color: s.color,
                              borderColor: s.border,
                              background: s.bg,
                            }}
                          >
                            {s.label}
                          </span>
                        </div>
                        <div className="card-title">{m.title}</div>
                        <div className="card-summary">{m.summary}</div>
                      </div>
                      <span className={`chevron ${isOpen ? "open" : ""}`}>▶</span>
                    </div>

                    <div className={`tasks ${isOpen ? "open" : ""}`}>
                      <div className="tasks-inner">
                        {m.tasks.map((t, i) => (
                          <div className="task-item" key={i}>
                            <span
                              className="task-check"
                              style={{ color: s.color, opacity: m.status === "future" ? 0.3 : 0.7 }}
                            >
                              {m.status === "done" ? "✓" : "·"}
                            </span>
                            <span>{t}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="footer-note">
            <div>
              <span className="footer-text">// open source, </span>
              <a className="footer-link" href="https://github.com/YarinCardillo/hush-app" target="_blank" rel="noopener noreferrer">github.com/YarinCardillo/hush-app</a>
            </div>
            <a className="footer-link" href="https://gethush.live" target="_blank" rel="noopener noreferrer">gethush.live →</a>
          </div>

        </div>
      </div>
    </>
  );
}
