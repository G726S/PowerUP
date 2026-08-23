export function CourseCardSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-lg border-2 border-[var(--color-ink)] bg-white p-6">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 shrink-0 animate-pulse rounded border-2 border-[var(--color-ink)] bg-[var(--color-cream)]" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--color-cream)]" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-[var(--color-cream)]" />
        </div>
      </div>
      <div className="h-4 w-full animate-pulse rounded border-2 border-[var(--color-ink)] bg-[var(--color-cream)]" />
    </div>
  );
}
