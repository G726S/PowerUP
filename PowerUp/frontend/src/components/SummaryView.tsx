import { useEffect, useRef, useState } from "react";
import * as api from "../api/client";
import { useSessionId } from "../session/SessionContext";
import { FormattedText } from "./FormattedText";
import { SpinnerIcon } from "./icons";

interface SummaryViewProps {
  courseId: string;
  chapterId: string;
}

export function SummaryView({ courseId, chapterId }: SummaryViewProps) {
  const sessionId = useSessionId();
  const [summary, setSummary] = useState<string | null | undefined>(undefined);
  const [status, setStatus] = useState<string>("processing");
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSummary(undefined);
    setStatus("processing");
    setError(null);

    async function poll() {
      try {
        const data = await api.getSummary(sessionId, courseId, chapterId);
        if (cancelled) return;
        setStatus(data.status);
        setSummary(data.summary);
        // The chapter's overall status can still say "processing" for a
        // moment after this endpoint's own status settles -- keep polling
        // until it's genuinely done so this view doesn't get stuck showing
        // "generating..." forever once the real content is ready.
        if (data.status === "processing") pollRef.current = setTimeout(poll, 3000);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load the summary.");
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

  if (summary === undefined || status === "processing") {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-cream)] p-8 text-center">
        <SpinnerIcon className="h-6 w-6 text-[var(--color-ink)]" />
        <p className="font-mono text-sm font-bold text-[var(--color-ink)]">GENERATING SUMMARY…</p>
      </div>
    );
  }

  if (status === "error" || !summary) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-red-soft)] p-8 text-center font-mono text-sm text-[var(--color-ink)]">
        {status === "error" ? "This chapter failed to process." : "No summary was generated."}
      </div>
    );
  }

  return (
    <div className="rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-cream)] p-8">
      <FormattedText text={summary} className="font-mono text-sm text-[var(--color-ink)]" />
    </div>
  );
}
