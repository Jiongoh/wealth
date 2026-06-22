type HandDrawnDividerProps = {
  className?: string;
};

/**
 * Irregular hand-drawn hairline used to section the sidebar — echoes the
 * "不规则手绘线条" divider in the design language (#d8d0c5, ~1.5px).
 */
export function HandDrawnDivider({ className }: HandDrawnDividerProps) {
  return (
    <svg
      aria-hidden="true"
      className={`hand-divider${className ? ` ${className}` : ""}`}
      preserveAspectRatio="none"
      viewBox="0 0 300 5"
    >
      <path
        d="M1 3.1 C 34 1.4, 58 3.6, 94 2.4 S 158 1.2, 198 3 S 262 3.4, 299 1.9"
        fill="none"
        stroke="#D97757"
        strokeLinecap="round"
        strokeWidth="1.4"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
