type StatCardProps = {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "warm" | "accent" | "dark";
  valueTone?: "positive" | "negative";
};

export function StatCard({ label, value, hint, tone = "default", valueTone }: StatCardProps) {
  return (
    <article className={`stat-card stat-card-${tone} soft-card`}>
      <p className="stat-label">{label}</p>
      <p className={`stat-value${valueTone ? ` stat-value-${valueTone}` : ""}`}>{value}</p>
      {hint ? <p className="stat-hint">{hint}</p> : null}
    </article>
  );
}
