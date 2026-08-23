import { Link } from "react-router-dom";
import type { CourseSummary } from "../types";
import { ProgressBar } from "./ProgressBar";
import { TrashIcon, ZapIcon } from "./icons";
import { accentColor, initials } from "../lib/format";

interface CourseCardProps {
  course: CourseSummary;
  onRequestDelete: (course: CourseSummary) => void;
}

export function CourseCard({ course, onRequestDelete }: CourseCardProps) {
  const color = accentColor(course.title);
  const mastery = course.mcq_count > 0 ? course.mastered_count / course.mcq_count : 0;

  return (
    <Link
      to={`/courses/${course.course_id}`}
      className="group relative flex flex-col gap-4 rounded-lg border-2 border-[var(--color-ink)] bg-white p-6 shadow-[var(--shadow-brutal-md)] transition-all duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[var(--shadow-brutal-lg)] focus-visible:-translate-x-0.5 focus-visible:-translate-y-0.5"
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRequestDelete(course);
        }}
        aria-label={`Delete ${course.title}`}
        className="absolute right-4 top-4 rounded border-2 border-transparent p-1.5 text-[var(--color-ink)] opacity-0 transition-opacity hover:border-[var(--color-ink)] hover:bg-[var(--color-red-soft)] focus-visible:opacity-100 group-hover:opacity-100"
      >
        <TrashIcon />
      </button>

      <div className="flex items-center gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded border-2 border-[var(--color-ink)] font-mono text-sm font-bold text-[var(--color-ink)]"
          style={{ backgroundColor: color }}
        >
          {initials(course.title)}
        </div>
        <div className="min-w-0 pr-6">
          <h3 title={course.title} className="truncate font-mono text-lg font-bold uppercase text-[var(--color-ink)]">
            {course.title}
          </h3>
          <p className="font-mono text-xs text-[var(--color-muted)]">
            {course.chapter_count} {course.chapter_count === 1 ? "CHAPTER" : "CHAPTERS"}
            {" · "}
            {course.mcq_count} QUESTIONS
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-[var(--color-ink)]">
        <ZapIcon className="h-3.5 w-3.5 text-[var(--color-orange)]" />
        POWER {course.power}
        {course.review_due_count > 0 && (
          <span className="ml-auto rounded border-2 border-[var(--color-ink)] bg-[var(--color-yellow)] px-1.5 py-0.5">
            {course.review_due_count} TO REVIEW
          </span>
        )}
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between font-mono text-xs font-bold text-[var(--color-ink)]">
          <span>MASTERED</span>
          <span>
            {course.mastered_count}/{course.mcq_count}
          </span>
        </div>
        <ProgressBar value={mastery} />
      </div>
    </Link>
  );
}
