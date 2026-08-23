import { useEffect, useRef, useState } from "react";
import * as api from "../api/client";
import { useSessionId } from "../session/SessionContext";
import type { VideoStatus } from "../types";
import { DownloadIcon, SpinnerIcon } from "./icons";

interface VideoViewProps {
  courseId: string;
  chapterId: string;
}

export function VideoView({ courseId, chapterId }: VideoViewProps) {
  const sessionId = useSessionId();
  const [status, setStatus] = useState<VideoStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const data = await api.getVideoStatus(sessionId, courseId, chapterId);
        if (cancelled) return;
        setStatus(data.status as VideoStatus);
        setError(data.error);
        if (data.status === "generating" || data.status === "none") {
          pollRef.current = setTimeout(poll, 4000);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't check video status.");
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [sessionId, courseId, chapterId]);

  async function handleRetry() {
    setIsRetrying(true);
    try {
      const data = await api.retryVideoSummary(sessionId, courseId, chapterId);
      setStatus(data.status as VideoStatus);
      setError(null);
      pollRef.current = setTimeout(async function poll() {
        const s = await api.getVideoStatus(sessionId, courseId, chapterId);
        setStatus(s.status as VideoStatus);
        setError(s.error);
        if (s.status === "generating") pollRef.current = setTimeout(poll, 4000);
      }, 4000);
    } finally {
      setIsRetrying(false);
    }
  }

  if (status === null) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <SpinnerIcon className="h-6 w-6 text-[var(--color-ink)]" />
      </div>
    );
  }

  if (status === "generating" || status === "none") {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-cream)] p-8 text-center">
        <SpinnerIcon className="h-6 w-6 text-[var(--color-ink)]" />
        <p className="font-mono text-sm font-bold text-[var(--color-ink)]">GENERATING VIDEO SUMMARY…</p>
        <p className="font-mono text-xs text-[var(--color-muted)]">
          This assembles narration and hand-drawn diagrams, so it can take a few minutes.
        </p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-red-soft)] p-8 text-center">
        <p className="font-mono text-sm font-bold text-[var(--color-ink)]">VIDEO GENERATION FAILED</p>
        {error && <p className="max-w-md font-mono text-xs text-[var(--color-ink)]">{error}</p>}
        <button
          type="button"
          onClick={handleRetry}
          disabled={isRetrying}
          className="mt-1 inline-flex items-center gap-1.5 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-pink)] px-4 py-2 font-mono text-sm font-bold text-white shadow-[var(--shadow-brutal-sm)] disabled:opacity-60"
        >
          {isRetrying && <SpinnerIcon className="h-3.5 w-3.5" />}
          RETRY
        </button>
      </div>
    );
  }

  const url = api.videoSummaryUrl(sessionId, courseId, chapterId);

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <a
          href={url}
          download="summary.mp4"
          className="inline-flex items-center gap-1.5 rounded-lg border-2 border-[var(--color-ink)] bg-white px-3.5 py-2 font-mono text-xs font-bold text-[var(--color-ink)] shadow-[var(--shadow-brutal-sm)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[var(--shadow-brutal-md)]"
        >
          <DownloadIcon className="h-3.5 w-3.5" />
          DOWNLOAD VIDEO
        </a>
      </div>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        src={url}
        controls
        className="w-full rounded-lg border-2 border-[var(--color-ink)] bg-black"
      />
    </div>
  );
}
