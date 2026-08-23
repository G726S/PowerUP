import { Link } from "react-router-dom";
import type { Course } from "../types";
import { ProgressBar } from "./ProgressBar";
import { TrashIcon, SpinnerIcon } from "./icons";
import { accentColor, initials, relativeTime } from "../lib/format";

interface CourseCardProps {
  course: Course;
  onRequestDelete: (course: Course) => void;
}

export function CourseCard({ course, onRequestDelete }: CourseCardProps) {
  const color = accentColor(course.name);
  const processingCount = course.materials.filter((m) => m.status === "processing").length;
  const pct = Math.round(course.progress * 100);

  return (
    <Link
      to={`/courses/${course.id}`}
      className="group relative flex flex-col gap-4 rounded-lg border-2 border-[var(--color-ink)] bg-white p-6 shadow-[var(--shadow-brutal-md)] transition-all duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[var(--shadow-brutal-lg)] focus-visible:-translate-x-0.5 focus-visible:-translate-y-0.5"
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRequestDelete(course);
        }}
        aria-label={`Delete ${course.name}`}
        className="absolute right-4 top-4 rounded border-2 border-transparent p-1.5 text-[var(--color-ink)] opacity-0 transition-opacity hover:border-[var(--color-ink)] hover:bg-[var(--color-red-soft)] focus-visible:opacity-100 group-hover:opacity-100"
      >
        <TrashIcon />
      </button>

      <div className="flex items-center gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded border-2 border-[var(--color-ink)] font-mono text-sm font-bold text-[var(--color-ink)]"
          style={{ backgroundColor: color }}
        >
          {initials(course.name)}
        </div>
        <div className="min-w-0 pr-6">
          <h3 title={course.name} className="truncate font-mono text-lg font-bold uppercase text-[var(--color-ink)]">
            {course.name}
          </h3>
          <p className="font-mono text-xs text-[var(--color-muted)]">
            {course.materials.length} {course.materials.length === 1 ? "MATERIAL" : "MATERIALS"}
            {" · "}
            ADDED {relativeTime(course.created_at).toUpperCase()}
          </p>
        </div>
      </div>

      {processingCount > 0 && (
        <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-[var(--color-ink)]">
          <SpinnerIcon className="h-3 w-3" />
          PROCESSING {processingCount} {processingCount === 1 ? "MATERIAL" : "MATERIALS"}…
        </div>
      )}

      <div>
        <div className="mb-1.5 flex items-center justify-between font-mono text-xs font-bold text-[var(--color-ink)]">
          <span>PROGRESS</span>
          <span>{pct}%</span>
        </div>
        <ProgressBar value={course.progress} />
      </div>
    </Link>
  );
}
