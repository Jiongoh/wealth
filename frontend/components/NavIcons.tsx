type IconProps = {
  className?: string;
};

/**
 * 1.5px line icon set for the sidebar navigation. Each icon inherits
 * `currentColor` so the nav-link can tint it (muted → coral when active).
 */

function Svg({ children, className }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className={`nav-icon${className ? ` ${className}` : ""}`}
      fill="none"
      height="20"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="20"
    >
      {children}
    </svg>
  );
}

export function DashboardIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect height="7" rx="1.5" width="7" x="3" y="3" />
      <rect height="7" rx="1.5" width="7" x="14" y="3" />
      <rect height="7" rx="1.5" width="7" x="14" y="14" />
      <rect height="7" rx="1.5" width="7" x="3" y="14" />
    </Svg>
  );
}

export function PositionsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
      <path d="M22 12A10 10 0 0 0 12 2v10z" />
    </Svg>
  );
}

export function WatchlistIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2.5l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.9l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z" />
    </Svg>
  );
}

export function TradesIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m17 4 4 4-4 4" />
      <path d="M21 8H8" />
      <path d="m7 20-4-4 4-4" />
      <path d="M3 16h13" />
    </Svg>
  );
}

export function CashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect height="14" rx="2.5" width="19" x="2.5" y="6" />
      <path d="M2.5 10.5h19" />
      <circle cx="17.5" cy="15" r="1.2" />
    </Svg>
  );
}

export function SyncIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 12a9 9 0 0 1 15.3-6.4L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.3 6.4L3 16" />
      <path d="M3 21v-5h5" />
    </Svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}
