interface ProgressBarProps {
  value: number; // 0..1
  className?: string;
}

export function ProgressBar({ value, className = "" }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`h-4 w-full overflow-hidden rounded border-2 border-[var(--color-ink)] bg-white ${className}`}
    >
      <div
        className="h-full bg-[var(--color-pink)] transition-[width] duration-700 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
