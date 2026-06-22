/**
 * Hand-drawn "j" wordmark — a flowing J stem with a cross stroke, an ink
 * node at the descender terminal and a coral node as the tittle. Replaces
 * the former "IS" monogram in the sidebar brand.
 */
export function BrandMark() {
  return (
    <svg
      aria-hidden="true"
      className="brand-mark-svg"
      fill="none"
      viewBox="0 0 256 256"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Bottom node */}
      <circle cx="76" cy="178" r="10" stroke="#1A1A1A" strokeWidth="5" />

      {/* Main hand-drawn J */}
      <path
        d="M130 72 C132 95,132 118,130 140 C126 174,114 196,92 208"
        stroke="#1A1A1A"
        strokeLinecap="round"
        strokeWidth="9.5"
      />

      {/* Cross stroke */}
      <path
        d="M88 166 C118 152,150 146,178 144"
        stroke="#1A1A1A"
        strokeLinecap="round"
        strokeWidth="9.5"
      />

      {/* Top node — coral tittle */}
      <circle cx="128" cy="44" r="11" fill="#cc785c" stroke="#a9583e" strokeWidth="3" />
    </svg>
  );
}
