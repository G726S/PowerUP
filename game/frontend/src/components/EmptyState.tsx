import { BookIcon, PlusIcon } from "./icons";

interface EmptyStateProps {
  onCreateCourse: () => void;
}

export function EmptyState({ onCreateCourse }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-5 rounded-lg border-2 border-dashed border-[var(--color-ink)] bg-[var(--color-cream)] px-6 py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-yellow)] text-[var(--color-ink)]">
        <BookIcon className="h-7 w-7" />
      </div>
      <div className="space-y-1.5">
        <h2 className="font-serif text-xl font-bold text-[var(--color-ink)]">No courses yet</h2>
        <p className="max-w-sm font-mono text-sm text-[var(--color-muted)]">
          Add your lecture notes or slides and PowerUp will turn them into a study course you can
          track progress on.
        </p>
      </div>
      <button
        type="button"
        onClick={onCreateCourse}
        className="inline-flex items-center gap-2 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-pink)] px-5 py-2.5 font-mono text-sm font-bold text-white shadow-[var(--shadow-brutal-sm)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[var(--shadow-brutal-md)] active:translate-x-0 active:translate-y-0 active:shadow-none"
      >
        <PlusIcon />
        ADD YOUR FIRST COURSE
      </button>
    </div>
  );
}
