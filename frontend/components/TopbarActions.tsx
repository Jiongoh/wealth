function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M9.4 9.2a2.6 2.6 0 0 1 5 1c0 1.7-2.4 2-2.4 3.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path
        d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 4 1.2 5.3 1.8 6H4.7c.6-.7 1.8-2 1.8-6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function TopbarActions() {
  return (
    <div className="topbar-actions">
      <button className="topbar-icon-btn" type="button" aria-label="Help">
        <HelpIcon />
      </button>
      <button className="topbar-icon-btn" type="button" aria-label="Notifications">
        <BellIcon />
      </button>
    </div>
  );
}
