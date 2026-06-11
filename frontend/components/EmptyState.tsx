type EmptyStateProps = {
  title?: string;
  message: string;
};

export function EmptyState({ title = "No data yet", message }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon" aria-hidden="true">
        ~
      </span>
      <span>
        <strong className="empty-state-title">{title}</strong>
        <span className="empty-state-message">{message}</span>
      </span>
    </div>
  );
}
