import { useEffect, useRef, useState } from "react";
import * as api from "../api/client";
import { useSessionId } from "../session/SessionContext";
import type { MCQ } from "../types";
import { DownloadIcon, SpinnerIcon } from "./icons";

interface McqListViewProps {
  courseId: string;
  chapterId: string;
}

const LETTERS = ["A", "B", "C", "D"];

export function McqListView({ courseId, chapterId }: McqListViewProps) {
  const sessionId = useSessionId();
  const [mcqs, setMcqs] = useState<MCQ[] | null>(null);
  const [status, setStatus] = useState<string>("processing");
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMcqs(null);
    setStatus("processing");
    setError(null);

    async function poll() {
      try {
        const data = await api.getMcqs(sessionId, courseId, chapterId);
        if (cancelled) return;
        setStatus(data.status);
        setMcqs(data.mcqs);
        if (data.status === "processing") pollRef.current = setTimeout(poll, 3000);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load questions.");
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

  if (mcqs === null || status === "processing") {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-cream)] p-8 text-center">
        <SpinnerIcon className="h-6 w-6 text-[var(--color-ink)]" />
        <p className="font-mono text-sm font-bold text-[var(--color-ink)]">GENERATING QUESTIONS…</p>
      </div>
    );
  }

  if (mcqs.length === 0) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-cream)] p-8 text-center font-mono text-sm text-[var(--color-ink)]">
        No questions were generated for this chapter.
      </div>
    );
  }

  function toggle(id: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-xs text-[var(--color-muted)]">
          {mcqs.length} {mcqs.length === 1 ? "question is" : "questions are"} ready and waiting for you here. Jump into
          the game whenever you want to actually get quizzed on them!
        </p>
        <a
          href={api.mcqPdfUrl(sessionId, courseId)}
          download
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border-2 border-[var(--color-ink)] bg-white px-3.5 py-2 font-mono text-xs font-bold text-[var(--color-ink)] shadow-[var(--shadow-brutal-sm)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[var(--shadow-brutal-md)]"
        >
          <DownloadIcon className="h-3.5 w-3.5" />
          DOWNLOAD ALL AS PDF
        </a>
      </div>
      {mcqs.map((mcq, i) => {
        const isRevealed = revealed.has(mcq.question_id);
        return (
          <div key={mcq.question_id} className="rounded-lg border-2 border-[var(--color-ink)] bg-white p-5">
            <div className="mb-2 flex items-center gap-2 font-mono text-xs font-bold text-[var(--color-muted)]">
              <span>Q{i + 1}</span>
              <span className="rounded border-2 border-[var(--color-ink)] bg-[var(--color-cream)] px-1.5 py-0.5 uppercase">
                {mcq.difficulty}
              </span>
            </div>
            <p className="mb-3 font-serif text-base font-bold leading-snug text-[var(--color-ink)]">{mcq.question}</p>
            <div className="grid gap-2">
              {mcq.options.map((opt, oi) => {
                const letter = LETTERS[oi];
                const isCorrect = letter === mcq.correct_answer;
                return (
                  <div
                    key={oi}
                    className={`flex items-center gap-2.5 rounded-lg border-2 px-3 py-2 font-mono text-sm text-[var(--color-ink)] ${
                      isRevealed && isCorrect
                        ? "border-[var(--color-ink)] bg-[var(--color-green-soft)]"
                        : "border-[var(--color-ink)] bg-[var(--color-cream)]"
                    }`}
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 border-[var(--color-ink)] text-xs font-bold">
                      {letter}
                    </span>
                    <span className="flex-1">{opt}</span>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => toggle(mcq.question_id)}
              className="mt-3 font-mono text-xs font-bold text-[var(--color-pink-dark)] underline underline-offset-2"
            >
              {isRevealed ? "HIDE ANSWER" : "SHOW ANSWER"}
            </button>
            {isRevealed && (
              <p className="mt-2 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-cream)] p-3 font-mono text-xs text-[var(--color-ink)]">
                {mcq.explanation}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
