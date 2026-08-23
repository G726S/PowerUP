import type { MaterialStatus } from "../types";
import { AlertIcon, CheckIcon, SpinnerIcon } from "./icons";

const CONFIG: Record<MaterialStatus, { label: string; classes: string; icon: React.ReactNode }> = {
  processing: {
    label: "PROCESSING",
    classes: "bg-[var(--color-yellow)] text-[var(--color-ink)]",
    icon: <SpinnerIcon className="h-3 w-3" />,
  },
  ready: {
    label: "READY",
    classes: "bg-[var(--color-green-soft)] text-[var(--color-ink)]",
    icon: <CheckIcon className="h-3 w-3" />,
  },
  error: {
    label: "FAILED",
    classes: "bg-[var(--color-red-soft)] text-[var(--color-ink)]",
    icon: <AlertIcon className="h-3 w-3" />,
  },
};

export function StatusBadge({ status }: { status: MaterialStatus }) {
  const c = CONFIG[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border-2 border-[var(--color-ink)] px-2 py-0.5 font-mono text-xs font-bold tracking-wide ${c.classes}`}
    >
      {c.icon}
      {c.label}
    </span>
  );
}
