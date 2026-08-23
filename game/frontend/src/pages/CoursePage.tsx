import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as api from "../api/client";
import type { Chapter, Course } from "../types";
import { DropZone } from "../components/DropZone";
import { ProgressBar } from "../components/ProgressBar";
import { StatusBadge } from "../components/StatusBadge";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FlashcardViewer } from "../components/FlashcardViewer";
import { QuizPlayer } from "../components/QuizPlayer";
import {
  CheckIcon,
  ChevronLeftIcon,
  PdfIcon,
  PlayIcon,
  SpinnerIcon,
  SquareStackIcon,
  TextIcon,
  TrashIcon,
  VideoIcon,
} from "../components/icons";
import { accentColor, initials, relativeTime } from "../lib/format";

type ActiveView = "summary" | "flashcards" | "video";

export function CoursePage() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const [course, setCourse] = useState<Course | null>(null);
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [expandedChapterId, setExpandedChapterId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>("summary");
  const [quizChapterId, setQuizChapterId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!courseId) return;
    try {
      const courses = await api.listCourses();
      const found = courses.find((c) => c.id === courseId) ?? null;
      if (!found) {
        setNotFound(true);
        return;
      }
      setCourse(found);
      // Chapters grow one at a time as PDFs finish processing, so just
      // always fetch the current list rather than gating on a status field.
      const ch = await api.listChapters(courseId);
      setChapters(ch);
      setExpandedChapterId((prev) => prev ?? ch[0]?.id ?? null);
    } catch {
      setNotFound(true);
    }
  }, [courseId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const materialProcessing = course?.materials.some((m) => m.status === "processing");
    if (!materialProcessing) return;
    pollRef.current = setTimeout(load, 2500);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [course, load]);

  async function handleAddFiles(files: File[]) {
    if (!courseId) return;
    setIsUploading(true);
    try {
      await api.uploadMaterials(courseId, files);
      await load();
    } finally {
      setIsUploading(false);
    }
  }

  async function handleConfirmDeleteMaterial() {
    if (!pendingDeleteId) return;
    setIsDeleting(true);
    try {
      await api.deleteMaterial(pendingDeleteId);
      if (expandedChapterId) {
        const stillExists = chapters?.some((c) => c.id === expandedChapterId && c.material_id !== pendingDeleteId);
        if (!stillExists) setExpandedChapterId(null);
      }
      await load();
      setPendingDeleteId(null);
    } finally {
      setIsDeleting(false);
    }
  }

  function selectChapter(chapterId: string) {
    setQuizChapterId(null);
    if (expandedChapterId === chapterId) {
      setExpandedChapterId(null);
      return;
    }
    setExpandedChapterId(chapterId);
    setActiveView("summary");
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <h1 className="font-serif text-xl font-bold text-[var(--color-ink)]">Course not found</h1>
        <p className="mt-2 font-mono text-sm text-[var(--color-muted)]">
          It may have been deleted, or the link is out of date.
        </p>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-pink)] px-5 py-2.5 font-mono text-sm font-bold text-white shadow-[var(--shadow-brutal-sm)]"
        >
          BACK TO COURSES
        </button>
      </div>
    );
  }

  if (!course) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-14 md:px-10">
        <div className="h-6 w-40 animate-pulse rounded bg-[var(--color-cream)]" />
      </div>
    );
  }

  const color = accentColor(course.name);
  const expandedChapter = chapters?.find((c) => c.id === expandedChapterId) ?? null;
  const sourceMaterial = expandedChapter
    ? course.materials.find((m) => m.id === expandedChapter.material_id)
    : null;
  const isProcessingMaterial = course.materials.some((m) => m.status === "processing");

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 md:px-10 md:py-14">
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1 font-mono text-sm font-bold text-[var(--color-ink)] hover:underline"
      >
        <ChevronLeftIcon />
        COURSES
      </Link>

      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="w-full shrink-0 rounded-lg border-2 border-[var(--color-ink)] bg-white p-5 shadow-[var(--shadow-brutal-md)] lg:w-80">
          <div className="mb-4 flex items-center gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded border-2 border-[var(--color-ink)] font-mono text-sm font-bold text-[var(--color-ink)]"
              style={{ backgroundColor: color }}
            >
              {initials(course.name)}
            </div>
            <div className="min-w-0">
              <h1 title={course.name} className="truncate font-mono text-lg font-bold uppercase text-[var(--color-ink)]">
                {course.name}
              </h1>
              <p className="font-mono text-xs text-[var(--color-muted)]">ADDED {relativeTime(course.created_at).toUpperCase()}</p>
            </div>
          </div>

          <div className="mb-5">
            <ProgressBar value={course.progress} />
            <p className="mt-1.5 font-mono text-xs font-bold text-[var(--color-ink)]">
              {Math.round(course.progress * 100)}% DONE
            </p>
          </div>

          <ChapterList
            chapters={chapters}
            isProcessingMaterial={isProcessingMaterial}
            expandedChapterId={expandedChapterId}
            activeView={activeView}
            onSelectChapter={selectChapter}
            onSelectView={(view) => {
              setQuizChapterId(null);
              setActiveView(view);
            }}
          />

          <MaterialsSection
            course={course}
            isUploading={isUploading}
            onAddFiles={handleAddFiles}
            onRequestDelete={setPendingDeleteId}
          />
        </aside>

        <main className="min-h-[420px] min-w-0 flex-1 rounded-lg border-2 border-[var(--color-ink)] bg-white p-6 shadow-[var(--shadow-brutal-md)]">
          {expandedChapter && !quizChapterId && (
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <span className="font-mono text-xs font-bold tracking-wide text-[var(--color-muted)]">
                  CH.{expandedChapter.order_index + 1}
                  {sourceMaterial && ` · FROM ${sourceMaterial.original_name.toUpperCase()}`}
                </span>
                <h2 className="font-mono text-xl font-bold uppercase text-[var(--color-ink)]">{expandedChapter.title}</h2>
              </div>
              <button
                type="button"
                onClick={() => setQuizChapterId(expandedChapter.id)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-pink)] px-4 py-2.5 font-mono text-sm font-bold text-white shadow-[var(--shadow-brutal-sm)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[var(--shadow-brutal-md)] active:translate-x-0 active:translate-y-0 active:shadow-none"
              >
                <PlayIcon />
                PLAY QUIZ
              </button>
            </div>
          )}

          {quizChapterId ? (
            <QuizPlayer
              chapterId={quizChapterId}
              onClose={() => setQuizChapterId(null)}
              onCompleted={async () => {
                setQuizChapterId(null);
                await load();
              }}
            />
          ) : !expandedChapter ? (
            <ChaptersEmptyState course={course} isProcessingMaterial={isProcessingMaterial} />
          ) : activeView === "summary" ? (
            <div className="rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-cream)] p-8">
              <p className="whitespace-pre-line font-mono text-sm leading-relaxed text-[var(--color-ink)]">
                {expandedChapter.summary}
              </p>
            </div>
          ) : activeView === "flashcards" ? (
            <FlashcardViewer chapterId={expandedChapter.id} />
          ) : (
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[var(--color-ink)] bg-[var(--color-cream)] p-8 text-center">
              <VideoIcon className="h-8 w-8 text-[var(--color-muted)]" />
              <p className="font-mono text-sm font-bold text-[var(--color-muted)]">COMING SOON</p>
            </div>
          )}
        </main>
      </div>

      {pendingDeleteId && (
        <ConfirmDialog
          title="Delete this material?"
          description="This removes the PDF and the chapter it created. This can't be undone."
          confirmLabel={isDeleting ? "Deleting…" : "Delete material"}
          isBusy={isDeleting}
          onConfirm={handleConfirmDeleteMaterial}
          onCancel={() => setPendingDeleteId(null)}
        />
      )}
    </div>
  );
}

function ChaptersEmptyState({ course, isProcessingMaterial }: { course: Course; isProcessingMaterial: boolean }) {
  if (course.materials.length === 0) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 text-center">
        <p className="font-mono text-sm font-bold text-[var(--color-ink)]">NO MATERIALS YET</p>
        <p className="font-mono text-xs text-[var(--color-muted)]">Add a PDF below -- each one becomes a chapter.</p>
      </div>
    );
  }
  if (isProcessingMaterial) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-center">
        <SpinnerIcon className="h-6 w-6 text-[var(--color-ink)]" />
        <p className="font-mono text-sm font-bold text-[var(--color-ink)]">TURNING YOUR PDF INTO A CHAPTER…</p>
      </div>
    );
  }
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-center">
      <p className="font-mono text-sm font-bold text-[var(--color-ink)]">COULDN'T CREATE A CHAPTER</p>
      <p className="font-mono text-xs text-[var(--color-muted)]">Check the materials below for the error, then try again.</p>
    </div>
  );
}

interface ChapterListProps {
  chapters: Chapter[] | null;
  isProcessingMaterial: boolean;
  expandedChapterId: string | null;
  activeView: ActiveView;
  onSelectChapter: (chapterId: string) => void;
  onSelectView: (view: ActiveView) => void;
}

function ChapterList({ chapters, isProcessingMaterial, expandedChapterId, activeView, onSelectChapter, onSelectView }: ChapterListProps) {
  if (!chapters || chapters.length === 0) {
    if (isProcessingMaterial) {
      return (
        <div className="mb-5 flex items-center gap-2 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-cream)] px-3 py-3 font-mono text-xs font-bold text-[var(--color-ink)]">
          <SpinnerIcon className="h-3.5 w-3.5" />
          BUILDING FIRST CHAPTER…
        </div>
      );
    }
    return (
      <p className="mb-5 rounded-lg border-2 border-dashed border-[var(--color-ink)] px-3 py-4 text-center font-mono text-xs text-[var(--color-muted)]">
        No chapters yet.
      </p>
    );
  }

  const subItems: { key: ActiveView; label: string; icon: React.ReactNode }[] = [
    { key: "summary", label: "Summary", icon: <TextIcon className="h-4 w-4" /> },
    { key: "flashcards", label: "Flashcards", icon: <SquareStackIcon className="h-4 w-4" /> },
    { key: "video", label: "Video", icon: <VideoIcon className="h-4 w-4" /> },
  ];

  return (
    <div className="mb-5 space-y-2">
      {chapters.map((chapter) => {
        const isExpanded = chapter.id === expandedChapterId;
        return (
          <div key={chapter.id} className="overflow-hidden rounded-lg border-2 border-[var(--color-ink)]">
            <button
              type="button"
              onClick={() => onSelectChapter(chapter.id)}
              className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left font-mono text-sm font-bold uppercase transition-colors ${
                isExpanded ? "bg-[var(--color-orange)]" : "bg-white hover:bg-[var(--color-cream)]"
              }`}
            >
              <span className="truncate">
                CH.{chapter.order_index + 1} {chapter.title}
              </span>
              {chapter.completed && <CheckIcon className="h-4 w-4 shrink-0" />}
            </button>
            {isExpanded && (
              <div className="border-t-2 border-[var(--color-ink)]">
                {subItems.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => onSelectView(item.key)}
                    className={`flex w-full items-center gap-2 border-b-2 border-[var(--color-ink)] px-3 py-2.5 text-left font-mono text-sm last:border-b-0 ${
                      activeView === item.key ? "bg-[var(--color-yellow)] font-bold" : "bg-white hover:bg-[var(--color-cream)]"
                    }`}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {isProcessingMaterial && (
        <div className="flex items-center gap-2 rounded-lg border-2 border-dashed border-[var(--color-ink)] px-3 py-2.5 font-mono text-xs font-bold text-[var(--color-muted)]">
          <SpinnerIcon className="h-3.5 w-3.5" />
          ADDING NEXT CHAPTER…
        </div>
      )}
    </div>
  );
}

interface MaterialsSectionProps {
  course: Course;
  isUploading: boolean;
  onAddFiles: (files: File[]) => void;
  onRequestDelete: (materialId: string) => void;
}

function MaterialsSection({ course, isUploading, onAddFiles, onRequestDelete }: MaterialsSectionProps) {
  return (
    <div className="border-t-2 border-dashed border-[var(--color-ink)] pt-4">
      <h2 className="mb-2 font-mono text-xs font-bold tracking-wide text-[var(--color-muted)]">MATERIALS</h2>
      {course.materials.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {course.materials.map((material) => (
            <li
              key={material.id}
              className="flex items-center gap-2 rounded-lg border-2 border-[var(--color-ink)] bg-white px-2.5 py-2"
            >
              <PdfIcon className="h-4 w-4 shrink-0 text-[var(--color-ink)]" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--color-ink)]">
                {material.original_name}
              </span>
              <StatusBadge status={material.status} />
              <button
                type="button"
                onClick={() => onRequestDelete(material.id)}
                aria-label={`Delete ${material.original_name}`}
                className="shrink-0 rounded p-1 text-[var(--color-ink)] hover:text-[var(--color-red)]"
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <DropZone onFilesSelected={onAddFiles} compact />
      {isUploading && <p className="mt-2 font-mono text-xs text-[var(--color-muted)]">UPLOADING…</p>}
    </div>
  );
}
