import { useEffect, useRef, useState } from "react";
import * as api from "../api/client";
import { useSessionId } from "../session/SessionContext";
import type { TutorMessage } from "../types";
import { FormattedText } from "./FormattedText";
import { SendIcon, SpinnerIcon } from "./icons";

interface TutorChatViewProps {
  courseId: string;
}

export function TutorChatView({ courseId }: TutorChatViewProps) {
  const sessionId = useSessionId();
  const [history, setHistory] = useState<TutorMessage[] | null>(null);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const requestedCourseId = courseId;
    setHistory(null);
    api
      .getChatHistory(sessionId, courseId)
      .then((data) => {
        // guard against a stale response landing after the user already
        // switched to a different course/chapter
        if (!cancelled && requestedCourseId === courseId) setHistory(data.history);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load chat history.");
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, courseId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  async function handleSend() {
    const message = input.trim();
    if (!message || isSending) return;
    setInput("");
    setError(null);
    setHistory((prev) => [...(prev ?? []), { role: "user", text: message }]);
    setIsSending(true);
    try {
      const data = await api.sendChatMessage(sessionId, courseId, message);
      setHistory(data.history);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The tutor couldn't respond to that.");
      setHistory((prev) => (prev ?? []).slice(0, -1));
      setInput(message);
    } finally {
      setIsSending(false);
    }
  }

  return (
    // No border/background of its own -- <main> (the panel this renders
    // inside) is already the one visible box. Sticky positioning against
    // main's own scroll turned out unreliable (main only has a max-height,
    // so the "stuck" bottom edge was ambiguous and messages could scroll
    // past/behind the input). Instead main hands this a real fixed height
    // (see CoursePage) and ONLY the message list scrolls internally here;
    // the input bar is a normal, non-scrolling flex item that's always
    // physically last, so nothing can ever scroll past or under it.
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-4">
        {history === null ? (
          <div className="flex min-h-[300px] items-center justify-center">
            <SpinnerIcon className="h-6 w-6 text-[var(--color-ink)]" />
          </div>
        ) : history.length === 0 ? (
          <p className="py-10 text-center font-mono text-sm text-[var(--color-muted)]">
            Ask the tutor anything about this course's material -- it's grounded in everything you've uploaded.
          </p>
        ) : (
          history.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-lg border-2 border-[var(--color-ink)] px-4 py-2.5 font-mono text-sm text-[var(--color-ink)] ${
                  msg.role === "user" ? "bg-[var(--color-yellow)]" : "bg-[var(--color-cream)]"
                }`}
              >
                <FormattedText text={msg.text} />
              </div>
            </div>
          ))
        )}
        {isSending && (
          <div className="flex justify-start">
            <div className="rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-cream)] px-4 py-2.5">
              <SpinnerIcon className="h-4 w-4 text-[var(--color-ink)]" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="mb-2 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-red-soft)] px-4 py-2 font-mono text-xs text-[var(--color-ink)]">
          {error}
        </p>
      )}

      <div className="flex shrink-0 items-center gap-2 border-t-2 border-[var(--color-ink)] bg-white pt-4">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Ask the tutor a question…"
          disabled={history === null}
          className="flex-1 rounded-lg border-2 border-[var(--color-ink)] bg-white px-3.5 py-2.5 font-mono text-sm text-[var(--color-ink)] placeholder:text-[var(--color-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-pink)] disabled:opacity-60"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!input.trim() || isSending || history === null}
          aria-label="Send"
          className="inline-flex shrink-0 items-center justify-center rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-pink)] p-3 text-white shadow-[var(--shadow-brutal-sm)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[var(--shadow-brutal-md)] active:translate-x-0 active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-40"
        >
          <SendIcon />
        </button>
      </div>
    </div>
  );
}
