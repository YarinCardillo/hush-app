/**
 * Room header wordmark. Inline SVG so fill follows CSS variables and works in both light and dark themes.
 * Design system: Cormorant Garamond italic, dot above "u" in --hush-amber, wordmark in --hush-text.
 */
export default function LogoWordmark({ style = {}, ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="25 0 290 110"
      fill="none"
      style={{ display: 'block', height: '28px', width: 'auto', userSelect: 'none', ...style }}
      aria-hidden
      {...props}
    >
      <defs>
        <filter id="logo-dot-blur" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" />
        </filter>
      </defs>
      <text
        x="170"
        y="82"
        fontFamily="'Cormorant Garamond', Georgia, serif"
        fontStyle="italic"
        fontWeight="400"
        fontSize="82"
        letterSpacing="5"
        fill="currentColor"
        textAnchor="middle"
      >
        hush
      </text>
      <circle
        cx="158"
        cy="25"
        r="9"
        fill="var(--hush-amber)"
        opacity="0.3"
        filter="url(#logo-dot-blur)"
      />
      <circle cx="158" cy="25" r="4.5" fill="var(--hush-amber)" />
    </svg>
  );
}
