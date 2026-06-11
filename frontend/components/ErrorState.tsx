type ErrorStateProps = {
  title?: string;
  message: string;
};

export function ErrorState({ title = "Unable to load data", message }: ErrorStateProps) {
  return (
    <div className="error-state" role="alert">
      <span className="state-icon" aria-hidden="true">
        !
      </span>
      <span>
        <strong className="state-title">{title}</strong>
        <span className="state-message">{message}</span>
      </span>
    </div>
  );
}
