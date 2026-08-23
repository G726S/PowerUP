import { useEffect, useState } from "react";
import * as api from "../api/client";
import { useSessionId } from "../session/SessionContext";
import type { Chapter } from "../types";
import { DownloadIcon, SpinnerIcon } from "./icons";

interface HandwrittenNotesViewProps {
  courseId: string;
  chapter: Chapter;
}

export function HandwrittenNotesView({ courseId, chapter }: HandwrittenNotesViewProps) {
  const sessionId = useSessionId();
  const [cacheBust, setCacheBust] = useState(0);

  // The URL/ready-state can change under us (chapter just finished
  // processing) -- bump a cache-busting param whenever the chapter's ready
  // flag flips so the <iframe> actually reloads instead of showing a stale
  // 409 it fetched before the PDF existed.
  useEffect(() => {
    setCacheBust((c) => c + 1);
  }, [chapter.handwritten_notes_ready]);

  if (chapter.handwritten_notes_error) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-red-soft)] p-8 text-center font-mono text-sm text-[var(--color-ink)]">
        {chapter.handwritten_notes_error}
      </div>
    );
  }

  // handwritten_notes_ready/error are set only once generation finishes
  // (one or the other, always) -- generation itself starts only AFTER the
  // chapter's core content (mcqs/flashcards/summary) is already "ready",
  // so "not ready yet, no error yet" always means still-in-progress here,
  // regardless of what chapter.status says.
  if (!chapter.handwritten_notes_ready) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-cream)] p-8 text-center">
        <SpinnerIcon className="h-6 w-6 text-[var(--color-ink)]" />
        <p className="font-mono text-sm font-bold text-[var(--color-ink)]">GENERATING HANDWRITTEN NOTES…</p>
      </div>
    );
  }

  const url = api.handwrittenNotesUrl(sessionId, courseId, chapter.chapter_id);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-xs text-[var(--color-muted)]">
          Your notes are all written out below, just like flipping through your own notebook. Take your time with
          them, or grab a copy to keep!
        </p>
        <a
          href={url}
          download="handwritten-notes.pdf"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border-2 border-[var(--color-ink)] bg-white px-3.5 py-2 font-mono text-xs font-bold text-[var(--color-ink)] shadow-[var(--shadow-brutal-sm)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[var(--shadow-brutal-md)]"
        >
          <DownloadIcon className="h-3.5 w-3.5" />
          DOWNLOAD PDF
        </a>
      </div>
      <iframe
        key={cacheBust}
        src={url}
        title="Handwritten notes"
        className="h-[75vh] w-full rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-cream)]"
      />
    </div>
  );
}
