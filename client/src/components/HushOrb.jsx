import { useState, useEffect, useRef } from 'react';

const EYE_STATES = {
  idle:       { left: 'M -6 0 Q 0 1.5 6 0',       right: 'M -6 0 Q 0 1.5 6 0',       opacity: 0.4  },
  waiting:    { left: 'M -5 2 Q 0 -4 5 2',         right: 'M -5 2 Q 0 -4 5 2',         opacity: 0.88 },
  activating: { left: 'M -6 3 Q 0 -7 6 3',         right: 'M -6 3 Q 0 -7 6 3',         opacity: 1    },
  hover:      { left: 'M -5 -1.5 Q 0 3.5 5 -1.5', right: 'M -5 -1.5 Q 0 3.5 5 -1.5', opacity: 0.6  },
};

const LABELS = {
  idle: 'connecting...',
  waiting: 'waiting for others to join',
  activating: 'someone just joined',
};

// CSS transition durations for each registered --ob-* property.
const T_COLOR  = '1.0s ease';
const T_GLOW   = '1.2s ease';
const T_RING   = '0.9s ease';
const T_SHADOW = '1.0s ease';

const ORB_TRANSITION = [
  `--ob-from ${T_COLOR}`,
  `--ob-mid ${T_COLOR}`,
  `--ob-to ${T_COLOR}`,
  `--ob-glow ${T_GLOW}`,
  `--ob-ring ${T_RING}`,
  `--ob-eye ${T_COLOR}`,
  `--ob-shadow-opacity ${T_SHADOW}`,
].join(', ');

// Eye stroke/shape transitions via CSS properties (enables d-morphing and color interpolation).
const EYE_PATH_TRANSITION = 'd 0.5s cubic-bezier(0.34,1.4,0.64,1), opacity 0.5s ease';

function OrbEyes({ eyeState }) {
  const eyes = EYE_STATES[eyeState] ?? EYE_STATES.idle;
  const pathStyle = {
    fill: 'none',
    stroke: 'var(--ob-eye)',
    strokeWidth: '1.8px',
    strokeLinecap: 'round',
    opacity: eyes.opacity,
    transition: EYE_PATH_TRANSITION,
  };
  return (
    <svg
      width="56" height="56" viewBox="0 0 56 56"
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 4 }}
    >
      <g transform="translate(18, 27)">
        {/* d attribute: SVG fallback. CSS d property: used for transition (overrides attribute). */}
        <path d={eyes.left}  style={{ ...pathStyle, d: `path("${eyes.left}")` }} />
      </g>
      <g transform="translate(38, 27)">
        <path d={eyes.right} style={{ ...pathStyle, d: `path("${eyes.right}")` }} />
      </g>
    </svg>
  );
}

/**
 * Ambient orb mascot for voice channel empty states.
 * Phase is controlled externally by VoiceChannel based on room state.
 *
 * @param {'idle'|'waiting'|'activating'} phase - Current room state.
 */
export default function HushOrb({ phase = 'idle', label }) {
  const [hovered, setHovered] = useState(false);

  // Cross-fade the label text when phase (or explicit label) changes.
  const [labelText, setLabelText]       = useState(label ?? LABELS[phase] ?? '');
  const [labelVisible, setLabelVisible] = useState(true);
  const labelTimerRef = useRef(null);

  useEffect(() => {
    const next = label ?? LABELS[phase] ?? '';
    if (next === labelText) return;
    if (labelTimerRef.current) clearTimeout(labelTimerRef.current);
    setLabelVisible(false);
    labelTimerRef.current = setTimeout(() => {
      setLabelText(next);
      setLabelVisible(true);
    }, 220);
    return () => clearTimeout(labelTimerRef.current);
  }, [phase, label]); // eslint-disable-line react-hooks/exhaustive-deps

  const eyeState = hovered ? 'hover' : phase;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/*
        data-orb-phase drives CSS custom property values via [data-orb-phase] rules in global.css.
        The transition here animates the @property-registered --ob-* tokens between phases,
        allowing radial-gradient colors and glow opacity to interpolate smoothly.
      */}
      <div
        data-orb-phase={phase}
        style={{
          position: 'relative', width: 220, height: 220,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: ORB_TRANSITION,
        }}
      >
        {/* Ambient glow */}
        <div style={{
          position: 'absolute', width: 200, height: 200, borderRadius: '50%',
          background: 'radial-gradient(circle, var(--ob-glow) 0%, transparent 70%)',
          animation: 'orbPulse 3s ease-in-out infinite',
        }} />

        {/* Breathing ring */}
        <div style={{
          position: 'absolute', width: 130, height: 130, borderRadius: '50%',
          border: '1px solid var(--ob-ring)',
          animation: 'ringBreath 4s ease-in-out infinite',
        }} />

        {/* Orb ball */}
        <div style={{ position: 'relative', width: 56, height: 56 }}>
          {/* Orange glow shadow — opacity driven by --ob-shadow-opacity for smooth fade */}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            boxShadow: '0 0 40px rgba(213,79,18,0.5), 0 0 16px rgba(213,79,18,0.3)',
            opacity: 'var(--ob-shadow-opacity)',
            pointerEvents: 'none',
          }} />
          <div
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
              width: 56, height: 56, borderRadius: '50%',
              background: 'radial-gradient(circle at 38% 35%, var(--ob-from) 0%, var(--ob-mid) 50%, var(--ob-to) 100%)',
              boxShadow: '0 0 12px rgba(0,0,0,0.4)',
              transition: 'transform 0.2s ease',
              animation: phase === 'activating'
                ? 'orbBounce 0.65s cubic-bezier(0.34,1.56,0.64,1)'
                : 'orbBreath 5s ease-in-out infinite',
              transform: hovered ? 'scale(1.07) scaleY(0.95)' : 'scale(1)',
            }}
          />
          <OrbEyes eyeState={eyeState} />
        </div>

        {phase === 'activating' && [0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={{
            position: 'absolute', width: 3, height: 3, borderRadius: '50%',
            background: 'var(--hush-amber)', opacity: 0,
            animation: `particle${i % 3} 1s ease-out ${i * 0.12}s forwards`,
          }} />
        ))}
      </div>

      <div style={{ marginTop: 36, height: 20, display: 'flex', alignItems: 'center' }}>
        <span style={{
          color: phase === 'activating' ? 'var(--hush-amber)' : 'var(--hush-text-muted)',
          fontSize: 11, letterSpacing: '0.18em', marginRight: '-0.18em', textTransform: 'uppercase',
          fontFamily: 'var(--font-mono, monospace)',
          opacity: labelVisible ? 1 : 0,
          transition: 'color 0.6s ease, opacity 0.22s ease',
        }}>
          {labelText}
        </span>
      </div>

      <div style={{ marginTop: 20 }}>
        <div style={{
          width: 5, height: 5, borderRadius: '50%',
          background: phase !== 'idle' ? 'var(--hush-amber)' : 'var(--hush-elevated)',
          transition: 'background 0.4s ease',
          animation: phase === 'waiting' ? 'dotPing 1.4s ease-in-out infinite' : 'none',
        }} />
      </div>

      <style>{`
        @keyframes orbBreath  { 0%,100%{transform:scale(1)} 50%{transform:scale(1.04)} }
        @keyframes orbBounce  { 0%{transform:scale(1)} 40%{transform:scale(1.28)} 70%{transform:scale(0.94)} 100%{transform:scale(1)} }
        @keyframes orbPulse   { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.12);opacity:0.7} }
        @keyframes ringBreath { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.08);opacity:0.5} }
        @keyframes dotPing    { 0%,100%{opacity:0.3;transform:scale(1)} 50%{opacity:1;transform:scale(1.3)} }
        @keyframes particle0  { 0%{opacity:1;transform:translate(0,0) scale(1)} 100%{opacity:0;transform:translate(-30px,-44px) scale(0)} }
        @keyframes particle1  { 0%{opacity:1;transform:translate(0,0) scale(1)} 100%{opacity:0;transform:translate(38px,-36px) scale(0)} }
        @keyframes particle2  { 0%{opacity:1;transform:translate(0,0) scale(1)} 100%{opacity:0;transform:translate(20px,-52px) scale(0)} }
      `}</style>
    </div>
  );
}
