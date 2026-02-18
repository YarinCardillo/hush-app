/**
 * Shared background grain overlay. Renders once in App so all pages
 * share the same texture. Fixed, full viewport, pointer-events: none.
 */
export default function AppBackground() {
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
        opacity: 0.035,
      }}
    >
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <filter id="hush-app-grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="1.20"
            numOctaves="4"
            stitchTiles="stitch"
          />
        </filter>
        <rect width="100%" height="100%" filter="url(#hush-app-grain)" />
      </svg>
    </div>
  );
}
