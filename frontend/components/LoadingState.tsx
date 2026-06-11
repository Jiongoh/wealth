type LoadingStateProps = {
  message?: string;
};

export function LoadingState({ message = "Loading data..." }: LoadingStateProps) {
  return (
    <div className="loading-state" role="status">
      <span className="state-icon" aria-hidden="true">
        ...
      </span>
      <span>
        <strong className="state-title">Loading</strong>
        <span className="state-message">{message}</span>
      </span>
    </div>
  );
}
