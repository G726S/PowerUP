import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as api from "../api/client";
import { useSessionId } from "../session/SessionContext";
import type { Chapter, CourseSummary } from "../types";
import { DropZone } from "../components/DropZone";
import { StatusBadge } from "../components/StatusBadge";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { SummaryView } from "../components/SummaryView";
import { NotesView } from "../components/NotesView";
import { HandwrittenNotesView } from "../components/HandwrittenNotesView";
import { FlashcardViewer } from "../components/FlashcardViewer";
import { McqListView } from "../components/McqListView";
import { VideoView } from "../components/VideoView";
import { GameLobby } from "../components/GameLobby";
import { DashboardView } from "../components/DashboardView";
import { TutorChatView } from "../components/TutorChatView";
import {
  ChartIcon,
  ChatIcon,
  CheckIcon,
  ChevronLeftIcon,
  ListIcon,
  PencilIcon,
  PlayIcon,
  SpinnerIcon,
  SquareStackIcon,
  TextIcon,
  TrashIcon,
  VideoIcon,
  ZapIcon,
} from "../components/icons";
import { accentColor, initials } from "../lib/format";

type ChapterTab = "summary" | "notes" | "handwritten" | "flashcards" | "mcqs" | "video";

type MainView = { kind: "chapter"; tab: ChapterTab } | { kind: "game" } | { kind: "chat" } | { kind: "dashboard" };

const CHAPTER_TABS: { key: ChapterTab; label: string; icon: React.ReactNode }[] = [
  { key: "summary", label: "Summary", icon: <TextIcon className="h-4 w-4" /> },
  { key: "notes", label: "Notes", icon: <ListIcon className="h-4 w-4" /> },
  { key: "handwritten", label: "Handwritten Notes", icon: <PencilIcon className="h-4 w-4" /> },
  { key: "flashcards", label: "Flashcards", icon: <SquareStackIcon className="h-4 w-4" /> },
  { key: "mcqs", label: "MCQ List", icon: <ListIcon className="h-4 w-4" /> },
  { key: "video", label: "Video", icon: <VideoIcon className="h-4 w-4" /> },
];

export function CoursePage() {
  const sessionId = useSessionId();
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const [course, setCourse] = useState<CourseSummary | null>(null);
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [mainView, setMainView] = useState<MainView>({ kind: "chapter", tab: "summary" });
  const [isUploading, setIsUploading] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!courseId) return;
    try {
      const { courses } = await api.listCourses(sessionId);
      const found = courses.find((c) => c.course_id === courseId) ?? null;
      if (!found) {
        setNotFound(true);
        return;
      }
      setCourse(found);
      const { chapters: ch } = await api.listChapters(sessionId, courseId);
      setChapters(ch);
      setSelectedChapterId((prev) => prev ?? ch[0]?.chapter_id ?? null);
    } catch {
      setNotFound(true);
    }
  }, [sessionId, courseId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // Keep polling not just while core content (mcqs/flashcards/summary) is
    // processing, but also while a "ready" chapter's background extras
    // (easy notes, handwritten notes, video) are still generating -- those
    // start only once status flips to "ready" and this is the only place
    // that keeps the chapter prop (read directly by HandwrittenNotesView,
    // and the source of chapter.video_status for VideoView) fresh.
    const stillSettling = chapters?.some(
      (c) =>
        c.status === "processing" ||
        (c.status === "ready" &&
          ((!c.easy_notes_ready && !c.easy_notes_error) ||
            (!c.handwritten_notes_ready && !c.handwritten_notes_error) ||
            c.video_status === "generating" ||
            c.video_status === "none")),
    );
    if (!stillSettling) return;
    pollRef.current = setTimeout(load, 2500);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [chapters, load]);

  async function handleAddFiles(files: File[]) {
    if (!courseId) return;
    setIsUploading(true);
    try {
      for (const file of files) {
        await api.uploadChapter(sessionId, courseId, file);
      }
      await load();
    } finally {
      setIsUploading(false);
    }
  }

  async function handleConfirmDeleteChapter() {
    if (!pendingDeleteId || !courseId) return;
    setIsDeleting(true);
    try {
      await api.deleteChapter(sessionId, courseId, pendingDeleteId);
      if (selectedChapterId === pendingDeleteId) setSelectedChapterId(null);
      await load();
      setPendingDeleteId(null);
    } finally {
      setIsDeleting(false);
    }
  }

  function selectChapter(chapterId: string) {
    setSelectedChapterId(chapterId);
    setMainView({ kind: "chapter", tab: "summary" });
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

  if (!course || !courseId) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-14 md:px-10">
        <div className="h-6 w-40 animate-pulse rounded bg-[var(--color-cream)]" />
      </div>
    );
  }

  const color = accentColor(course.title);
  const selectedChapter = chapters?.find((c) => c.chapter_id === selectedChapterId) ?? null;
  const isProcessingAny = chapters?.some((c) => c.status === "processing") ?? false;

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
        <aside className="w-full shrink-0 overflow-y-auto rounded-lg border-2 border-[var(--color-ink)] bg-white p-5 shadow-[var(--shadow-brutal-md)] lg:w-80 lg:max-h-[calc(100vh-180px)]">
          <div className="mb-4 flex items-center gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded border-2 border-[var(--color-ink)] font-mono text-sm font-bold text-[var(--color-ink)]"
              style={{ backgroundColor: color }}
            >
              {initials(course.title)}
            </div>
            <div className="min-w-0">
              <h1 title={course.title} className="truncate font-mono text-lg font-bold uppercase text-[var(--color-ink)]">
                {course.title}
              </h1>
              <p className="flex items-center gap-1 font-mono text-xs text-[var(--color-muted)]">
                <ZapIcon className="h-3 w-3 text-[var(--color-orange)]" />
                POWER {course.power} · {course.mastered_count}/{course.mcq_count} MASTERED
              </p>
            </div>
          </div>

          <div className="mb-5 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setMainView({ kind: "game" })}
              className={`flex flex-col items-center gap-1 rounded-lg border-2 border-[var(--color-ink)] px-2 py-2.5 font-mono text-[10px] font-bold transition-colors ${
                mainView.kind === "game" ? "bg-[var(--color-pink)] text-white" : "bg-white text-[var(--color-ink)] hover:bg-[var(--color-cream)]"
              }`}
            >
              <PlayIcon className="h-4 w-4" />
              PLAY
            </button>
            <button
              type="button"
              onClick={() => setMainView({ kind: "dashboard" })}
              className={`flex flex-col items-center gap-1 rounded-lg border-2 border-[var(--color-ink)] px-2 py-2.5 font-mono text-[10px] font-bold transition-colors ${
                mainView.kind === "dashboard" ? "bg-[var(--color-pink)] text-white" : "bg-white text-[var(--color-ink)] hover:bg-[var(--color-cream)]"
              }`}
            >
              <ChartIcon className="h-4 w-4" />
              STATS
            </button>
            <button
              type="button"
              onClick={() => setMainView({ kind: "chat" })}
              className={`flex flex-col items-center gap-1 rounded-lg border-2 border-[var(--color-ink)] px-2 py-2.5 font-mono text-[10px] font-bold transition-colors ${
                mainView.kind === "chat" ? "bg-[var(--color-pink)] text-white" : "bg-white text-[var(--color-ink)] hover:bg-[var(--color-cream)]"
              }`}
            >
              <ChatIcon className="h-4 w-4" />
              TUTOR
            </button>
          </div>

          <ChapterList
            chapters={chapters}
            isProcessingAny={isProcessingAny}
            selectedChapterId={selectedChapterId}
            isChapterViewActive={mainView.kind === "chapter"}
            activeTab={mainView.kind === "chapter" ? mainView.tab : null}
            onSelectChapter={selectChapter}
            onSelectTab={(tab) => setMainView({ kind: "chapter", tab })}
            onRequestDelete={setPendingDeleteId}
          />

          <div className="border-t-2 border-dashed border-[var(--color-ink)] pt-4">
            <h2 className="mb-2 font-mono text-xs font-bold tracking-wide text-[var(--color-muted)]">ADD MATERIAL</h2>
            <DropZone onFilesSelected={handleAddFiles} compact />
            {isUploading && <p className="mt-2 font-mono text-xs text-[var(--color-muted)]">UPLOADING…</p>}
          </div>
        </aside>

        <main
          className={
            mainView.kind === "chat"
              ? // The chat view owns its own internal scrolling (only the message
                // list scrolls; the input bar is a normal, non-scrolling flex item
                // that always stays physically last) -- so this needs a real fixed
                // height to hand down, not just a max-height cap with its own
                // overflow, or the input bar has no stable bottom to anchor against.
                "flex min-h-[420px] min-w-0 flex-1 flex-col overflow-hidden rounded-lg border-2 border-[var(--color-ink)] bg-white p-6 shadow-[var(--shadow-brutal-md)] lg:h-[calc(100vh-180px)]"
              : "min-h-[420px] min-w-0 flex-1 overflow-y-auto rounded-lg border-2 border-[var(--color-ink)] bg-white p-6 shadow-[var(--shadow-brutal-md)] lg:max-h-[calc(100vh-180px)]"
          }
        >
          {mainView.kind === "game" ? (
            <GameLobby courseId={courseId} />
          ) : mainView.kind === "dashboard" ? (
            <DashboardView courseId={courseId} />
          ) : mainView.kind === "chat" ? (
            <TutorChatView courseId={courseId} />
          ) : !selectedChapter ? (
            <ChaptersEmptyState hasChapters={!!chapters?.length} isProcessingAny={isProcessingAny} />
          ) : (
            <>
              <div className="mb-5">
                <span className="font-mono text-xs font-bold tracking-wide text-[var(--color-muted)]">
                  {selectedChapter.sources.join(", ").toUpperCase()}
                </span>
                <h2 className="font-mono text-xl font-bold uppercase text-[var(--color-ink)]">{selectedChapter.title}</h2>
              </div>
              {selectedChapter.status === "error" ? (
                <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-red-soft)] p-8 text-center font-mono text-sm text-[var(--color-ink)]">
                  This chapter failed to process.
                  {selectedChapter.status_error && <p className="mt-1 text-xs">{selectedChapter.status_error}</p>}
                </div>
              ) : mainView.tab === "summary" ? (
                <SummaryView courseId={courseId} chapterId={selectedChapter.chapter_id} />
              ) : mainView.tab === "notes" ? (
                <NotesView courseId={courseId} chapterId={selectedChapter.chapter_id} />
              ) : mainView.tab === "handwritten" ? (
                <HandwrittenNotesView courseId={courseId} chapter={selectedChapter} />
              ) : mainView.tab === "flashcards" ? (
                <FlashcardViewer courseId={courseId} chapterId={selectedChapter.chapter_id} />
              ) : mainView.tab === "mcqs" ? (
                <McqListView courseId={courseId} chapterId={selectedChapter.chapter_id} />
              ) : (
                <VideoView courseId={courseId} chapterId={selectedChapter.chapter_id} />
              )}
            </>
          )}
        </main>
      </div>

      {pendingDeleteId && (
        <ConfirmDialog
          title="Delete this chapter?"
          description="This removes its questions, flashcards, notes, and video. This can't be undone."
          confirmLabel={isDeleting ? "Deleting…" : "Delete chapter"}
          isBusy={isDeleting}
          onConfirm={handleConfirmDeleteChapter}
          onCancel={() => setPendingDeleteId(null)}
        />
      )}
    </div>
  );
}

function ChaptersEmptyState({ hasChapters, isProcessingAny }: { hasChapters: boolean; isProcessingAny: boolean }) {
  if (!hasChapters) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 text-center">
        <p className="font-mono text-sm font-bold text-[var(--color-ink)]">NO CHAPTERS YET</p>
        <p className="font-mono text-xs text-[var(--color-muted)]">Add a PDF below -- each one becomes a chapter.</p>
      </div>
    );
  }
  if (isProcessingAny) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-center">
        <SpinnerIcon className="h-6 w-6 text-[var(--color-ink)]" />
        <p className="font-mono text-sm font-bold text-[var(--color-ink)]">TURNING YOUR PDF INTO A CHAPTER…</p>
      </div>
    );
  }
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 text-center">
      <p className="font-mono text-sm font-bold text-[var(--color-ink)]">SELECT A CHAPTER</p>
    </div>
  );
}

interface ChapterListProps {
  chapters: Chapter[] | null;
  isProcessingAny: boolean;
  selectedChapterId: string | null;
  isChapterViewActive: boolean;
  activeTab: ChapterTab | null;
  onSelectChapter: (chapterId: string) => void;
  onSelectTab: (tab: ChapterTab) => void;
  onRequestDelete: (chapterId: string) => void;
}

function ChapterList({
  chapters,
  isProcessingAny,
  selectedChapterId,
  isChapterViewActive,
  activeTab,
  onSelectChapter,
  onSelectTab,
  onRequestDelete,
}: ChapterListProps) {
  if (!chapters || chapters.length === 0) {
    if (isProcessingAny) {
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

  return (
    <div className="mb-5 space-y-2">
      {chapters.map((chapter, i) => {
        const isSelected = chapter.chapter_id === selectedChapterId;
        const isExpanded = isSelected && isChapterViewActive;
        return (
          <div key={chapter.chapter_id} className="overflow-hidden rounded-lg border-2 border-[var(--color-ink)]">
            <div
              className={`flex w-full items-center gap-2 px-3 py-2.5 ${isExpanded ? "bg-[var(--color-orange)]" : "bg-white"}`}
            >
              <button
                type="button"
                onClick={() => onSelectChapter(chapter.chapter_id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left font-mono text-sm font-bold uppercase"
              >
                <span className="truncate">
                  CH.{i + 1} {chapter.title}
                </span>
                {chapter.status === "processing" && <SpinnerIcon className="h-3.5 w-3.5 shrink-0" />}
                {chapter.status === "ready" && <CheckIcon className="h-4 w-4 shrink-0" />}
              </button>
              <button
                type="button"
                onClick={() => onRequestDelete(chapter.chapter_id)}
                aria-label={`Delete ${chapter.title}`}
                className="shrink-0 rounded p-1 text-[var(--color-ink)] hover:text-[var(--color-red)]"
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            {chapter.status === "error" && (
              <div className="border-t-2 border-[var(--color-ink)] bg-[var(--color-red-soft)] px-3 py-2">
                <StatusBadge status="error" />
              </div>
            )}
            {isExpanded && chapter.status === "ready" && (
              <div className="border-t-2 border-[var(--color-ink)]">
                {CHAPTER_TABS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => onSelectTab(item.key)}
                    className={`flex w-full items-center gap-2 border-b-2 border-[var(--color-ink)] px-3 py-2.5 text-left font-mono text-sm last:border-b-0 ${
                      activeTab === item.key ? "bg-[var(--color-yellow)] font-bold" : "bg-white hover:bg-[var(--color-cream)]"
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
      {isProcessingAny && (
        <div className="flex items-center gap-2 rounded-lg border-2 border-dashed border-[var(--color-ink)] px-3 py-2.5 font-mono text-xs font-bold text-[var(--color-muted)]">
          <SpinnerIcon className="h-3.5 w-3.5" />
          PROCESSING…
        </div>
      )}
    </div>
  );
}
