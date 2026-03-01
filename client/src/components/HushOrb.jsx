import { useState } from 'react';

const EYE_STATES = {
  idle: { left: 'M -6 0 Q 0 1.5 6 0', right: 'M -6 0 Q 0 1.5 6 0', opacity: 0.4 },
  waiting: { left: 'M -5 2 Q 0 -4 5 2', right: 'M -5 2 Q 0 -4 5 2', opacity: 0.7 },
  activating: { left: 'M -6 3 Q 0 -7 6 3', right: 'M -6 3 Q 0 -7 6 3', opacity: 1 },
  hover: { left: 'M -5 -1.5 Q 0 3.5 5 -1.5', right: 'M -5 -1.5 Q 0 3.5 5 -1.5', opacity: 0.6 },
};

const ORB_STYLES = {
  idle: {
    bg: 'radial-gradient(circle at 38% 35%, #26241e 0%, #1b1912 50%, #13120a 100%)',
    shadow: '0 0 12px rgba(0,0,0,0.4)',
    eyeColor: '#3a3a4e',
    glowBg: 'radial-gradient(circle, rgba(213,79,18,0) 0%, transparent 70%)',
    ringColor: 'transparent',
  },
  waiting: {
    bg: 'radial-gradient(circle at 38% 35%, #3c2018 0%, #261408 50%, #1b1912 100%)',
    shadow: '0 0 24px rgba(213,79,18,0.1)',
    eyeColor: '#8888a0',
    glowBg: 'radial-gradient(circle, rgba(213,79,18,0.04) 0%, transparent 70%)',
    ringColor: 'rgba(213,79,18,0.06)',
  },
  activating: {
    bg: 'radial-gradient(circle at 38% 35%, #e85a1a 0%, #d54f12 45%, #a33d0e 100%)',
    shadow: '0 0 40px rgba(213,79,18,0.5), 0 0 16px rgba(213,79,18,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
    eyeColor: '#13120a',
    glowBg: 'radial-gradient(circle, rgba(213,79,18,0.14) 0%, transparent 70%)',
    ringColor: 'rgba(213,79,18,0.28)',
  },
};

const LABELS = {
  idle: 'connecting...',
  waiting: 'waiting for others to join',
  activating: 'someone just joined',
};

function OrbEyes({ eyeState, color }) {
  const eyes = EYE_STATES[eyeState] ?? EYE_STATES.idle;
  return (
    <svg
      width="56" height="56" viewBox="0 0 56 56"
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 4 }}
    >
      <g transform="translate(18, 27)">
        <path
          d={eyes.left} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round"
          opacity={eyes.opacity}
          style={{ transition: 'all 0.5s cubic-bezier(0.34,1.4,0.64,1)' }}
        />
      </g>
      <g transform="translate(38, 27)">
        <path
          d={eyes.right} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round"
          opacity={eyes.opacity}
          style={{ transition: 'all 0.5s cubic-bezier(0.34,1.4,0.64,1)' }}
        />
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

  const eyeState = hovered ? 'hover' : phase;
  const orbStyle = ORB_STYLES[phase] ?? ORB_STYLES.idle;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ position: 'relative', width: 220, height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          position: 'absolute', width: 200, height: 200, borderRadius: '50%',
          background: orbStyle.glowBg,
          transition: 'background 1.2s ease',
          animation: 'orbPulse 3s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute', width: 130, height: 130, borderRadius: '50%',
          border: '1px solid', borderColor: orbStyle.ringColor,
          transition: 'border-color 0.8s ease',
          animation: 'ringBreath 4s ease-in-out infinite',
        }} />
        <div style={{ position: 'relative', width: 56, height: 56 }}>
          <div
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
              width: 56, height: 56, borderRadius: '50%',
              background: orbStyle.bg,
              boxShadow: orbStyle.shadow,
              transition: 'background 1.1s cubic-bezier(0.34,1.3,0.64,1), box-shadow 1.1s ease, transform 0.2s ease',
              animation: phase === 'activating'
                ? 'orbBounce 0.65s cubic-bezier(0.34,1.56,0.64,1)'
                : 'orbBreath 5s ease-in-out infinite',
              transform: hovered ? 'scale(1.07) scaleY(0.95)' : 'scale(1)',
            }}
          />
          <OrbEyes eyeState={eyeState} color={orbStyle.eyeColor} />
        </div>
        {phase === 'activating' && [0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={{
            position: 'absolute', width: 3, height: 3, borderRadius: '50%',
            background: '#d54f12', opacity: 0,
            animation: `particle${i % 3} 1s ease-out ${i * 0.12}s forwards`,
          }} />
        ))}
      </div>
      <div style={{ marginTop: 36, height: 20, display: 'flex', alignItems: 'center' }}>
        <span style={{
          color: phase === 'activating' ? 'rgba(213,79,18,0.7)' : 'rgba(255,255,255,0.15)',
          fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase',
          fontFamily: 'var(--font-mono, monospace)',
          transition: 'color 0.6s ease',
        }}>
          {label ?? LABELS[phase]}
        </span>
      </div>
      <div style={{ marginTop: 20, display: 'flex', gap: 6 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{
            width: 5, height: 5, borderRadius: '50%',
            background: i === 0 && phase !== 'idle' ? '#d54f12' : 'rgba(255,255,255,0.08)',
            transition: 'background 0.4s ease',
            animation: phase === 'waiting' && i === 0 ? 'dotPing 1.4s ease-in-out infinite' : 'none',
          }} />
        ))}
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
