import { useMemo, useState } from "react";
import { useCourses } from "../hooks/useCourses";
import * as api from "../api/client";
import { useSessionId } from "../session/SessionContext";
import type { CourseSummary } from "../types";
import { CourseCard } from "../components/CourseCard";
import { CourseCardSkeleton } from "../components/CourseCardSkeleton";
import { EmptyState } from "../components/EmptyState";
import { CreateCourseModal } from "../components/CreateCourseModal";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PlusIcon, SearchIcon } from "../components/icons";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function HomePage() {
  const sessionId = useSessionId();
  const { courses, error, refresh } = useCourses();
  const [query, setQuery] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CourseSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const filtered = useMemo(() => {
    if (!courses) return null;
    const q = query.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter((c) => c.title.toLowerCase().includes(q));
  }, [courses, query]);

  const totalChapters = courses?.reduce((sum, c) => sum + c.chapter_count, 0) ?? 0;

  async function handleCreate(name: string, files: File[]) {
    const course = await api.createCourse(sessionId, name);
    try {
      // Each PDF becomes its own chapter -- upload sequentially so a
      // failure partway through still leaves the earlier chapters intact.
      for (const file of files) {
        await api.uploadChapter(sessionId, course.course_id, file);
      }
    } finally {
      await refresh();
    }
    setIsCreateOpen(false);
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      await api.deleteCourse(sessionId, pendingDelete.course_id);
      await refresh();
      setPendingDelete(null);
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 md:px-10 md:py-14">
      <header className="mb-10 flex flex-col gap-1">
        <h1 className="font-serif text-3xl font-bold text-[var(--color-ink)] md:text-4xl">
          {getGreeting()}
        </h1>
        <p className="font-mono text-sm text-[var(--color-muted)]">
          {courses === null
            ? "LOADING YOUR COURSES…"
            : courses.length === 0
              ? "ADD A COURSE TO START STUDYING YOUR MATERIAL."
              : `${courses.length} ${courses.length === 1 ? "COURSE" : "COURSES"} · ${totalChapters} ${totalChapters === 1 ? "CHAPTER" : "CHAPTERS"}`}
        </p>
      </header>

      {error && (
        <div className="mb-6 flex items-center justify-between rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-red-soft)] px-4 py-3 font-mono text-sm text-[var(--color-ink)]">
          <span>{error}</span>
          <button type="button" onClick={() => refresh()} className="font-bold underline underline-offset-2">
            RETRY
          </button>
        </div>
      )}

      {courses === null ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <CourseCardSkeleton key={i} />
          ))}
        </div>
      ) : courses.length === 0 ? (
        <EmptyState onCreateCourse={() => setIsCreateOpen(true)} />
      ) : (
        <>
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:w-72">
              <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink)]" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search courses"
                aria-label="Search courses"
                className="w-full rounded-lg border-2 border-[var(--color-ink)] bg-white py-2.5 pl-10 pr-4 font-mono text-sm text-[var(--color-ink)] placeholder:text-[var(--color-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-pink)]"
              />
            </div>
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-pink)] px-5 py-2.5 font-mono text-sm font-bold text-white shadow-[var(--shadow-brutal-sm)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[var(--shadow-brutal-md)] active:translate-x-0 active:translate-y-0 active:shadow-none"
            >
              <PlusIcon />
              NEW COURSE
            </button>
          </div>

          {filtered && filtered.length === 0 ? (
            <p className="rounded-lg border-2 border-dashed border-[var(--color-ink)] px-6 py-16 text-center font-mono text-sm text-[var(--color-muted)]">
              No courses match "{query}".
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {filtered?.map((course) => (
                <CourseCard key={course.course_id} course={course} onRequestDelete={setPendingDelete} />
              ))}
            </div>
          )}
        </>
      )}

      {isCreateOpen && (
        <CreateCourseModal onClose={() => setIsCreateOpen(false)} onSubmit={handleCreate} />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete "${pendingDelete.title}"?`}
          description="This removes the course and all of its chapters. This can't be undone."
          confirmLabel={isDeleting ? "Deleting…" : "Delete course"}
          isBusy={isDeleting}
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
