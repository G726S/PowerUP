import { useEffect, useRef, useState } from "react";
import * as api from "../api/client";
import { useSessionId } from "../session/SessionContext";
import type { EasyNote } from "../types";
import { SpinnerIcon } from "./icons";

interface NotesViewProps {
  courseId: string;
  chapterId: string;
}

// Easy notes start generating only after the chapter's core content
// (mcqs/flashcards/summary) is already "ready", so a "ready, 0 notes"
// response can genuinely mean either "still generating" or "really came
// back empty" -- the endpoint can't tell them apart yet. Keep polling for
// a while before settling on "empty" so the common case (still generating)
// doesn't get misreported.
const MAX_EMPTY_POLLS = 8;

export function NotesView({ courseId, chapterId }: NotesViewProps) {
  const sessionId = useSessionId();
  const [notes, setNotes] = useState<EasyNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let emptyPolls = 0;
    setNotes(null);
    setError(null);
    setSettled(false);

    async function poll() {
      try {
        const data = await api.getEasyNotes(sessionId, courseId, chapterId);
        if (cancelled) return;
        setNotes(data.notes);
        if (data.status === "error") {
          setError(data.error ?? "Notes failed to generate.");
          setSettled(true);
          return;
        }
        const stillSettling = data.status === "processing" || (data.notes.length === 0 && emptyPolls < MAX_EMPTY_POLLS);
        if (stillSettling) {
          emptyPolls++;
          pollRef.current = setTimeout(poll, 3000);
        } else {
          setSettled(true);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load notes.");
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [sessionId, courseId, chapterId]);

  if (error) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-red-soft)] p-8 text-center font-mono text-sm text-[var(--color-ink)]">
        {error}
      </div>
    );
  }

  if (notes === null || !settled) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-cream)] p-8 text-center">
        <SpinnerIcon className="h-6 w-6 text-[var(--color-ink)]" />
        <p className="font-mono text-sm font-bold text-[var(--color-ink)]">GENERATING NOTES…</p>
      </div>
    );
  }

  if (notes.length === 0) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-cream)] p-8 text-center font-mono text-sm text-[var(--color-ink)]">
        No notes were generated for this chapter.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {notes.map((note, i) => (
        <div key={i} className="rounded-lg border-2 border-[var(--color-ink)] bg-white p-6">
          <h3 className="mb-2.5 font-serif text-lg font-bold text-[var(--color-ink)]">{note.heading}</h3>
          <p className="whitespace-pre-line font-mono text-sm leading-relaxed text-[var(--color-ink)]">
            {note.explanation}
          </p>
          {note.table && note.table.headers.length > 0 && (
            <div className="mt-4 overflow-x-auto rounded-lg border-2 border-[var(--color-ink)]">
              <table className="w-full border-collapse font-mono text-sm">
                <thead>
                  <tr className="bg-[var(--color-yellow)]">
                    {note.table.headers.map((h, hi) => (
                      <th
                        key={hi}
                        className="border-b-2 border-[var(--color-ink)] px-3 py-2 text-left font-bold text-[var(--color-ink)]"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {note.table.rows.map((row, ri) => (
                    <tr key={ri} className={ri % 2 === 1 ? "bg-[var(--color-cream)]" : "bg-white"}>
                      {row.map((cell, ci) => (
                        <td key={ci} className="border-t-2 border-[var(--color-ink)] px-3 py-2 text-[var(--color-ink)]">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
