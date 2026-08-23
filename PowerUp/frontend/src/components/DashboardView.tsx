import { useEffect, useState } from "react";
import * as api from "../api/client";
import { useSessionId } from "../session/SessionContext";
import type { CourseDashboard } from "../types";
import { FormattedText } from "./FormattedText";
import { SpinnerIcon, ZapIcon } from "./icons";

interface DashboardViewProps {
  courseId: string;
}

export function DashboardView({ courseId }: DashboardViewProps) {
  const sessionId = useSessionId();
  const [dashboard, setDashboard] = useState<CourseDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getCourseDashboard(sessionId, courseId)
      .then((data) => {
        if (!cancelled) setDashboard(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load the dashboard.");
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, courseId]);

  if (error) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-red-soft)] p-8 text-center font-mono text-sm text-[var(--color-ink)]">
        {error}
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <SpinnerIcon className="h-6 w-6 text-[var(--color-ink)]" />
      </div>
    );
  }

  const { stats, mistakes, summary } = dashboard;
  const cells: { label: string; value: string | number }[] = [
    { label: "TOTAL ANSWERED", value: stats.total },
    { label: "CORRECT", value: stats.correct },
    { label: "INCORRECT", value: stats.incorrect },
    { label: "MASTERED", value: stats.mastered_count },
    { label: "DUE FOR REVIEW", value: stats.review_due_count },
    { label: "ROUNDS PLAYED", value: stats.rounds_played },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-cream)] p-6">
        <div className="mb-3 flex items-center gap-2">
          <ZapIcon className="h-4 w-4 text-[var(--color-orange)]" />
          <span className="font-mono text-sm font-bold text-[var(--color-ink)]">POWER: {stats.power}</span>
        </div>
        <FormattedText text={summary} className="font-mono text-sm text-[var(--color-ink)]" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cells.map((cell) => (
          <div key={cell.label} className="rounded-lg border-2 border-[var(--color-ink)] bg-white p-4 text-center">
            <p className="font-serif text-2xl font-bold text-[var(--color-ink)]">{cell.value}</p>
            <p className="mt-1 font-mono text-[10px] font-bold tracking-wide text-[var(--color-muted)]">{cell.label}</p>
          </div>
        ))}
      </div>

      {mistakes.length > 0 && (
        <div>
          <h3 className="mb-3 font-mono text-xs font-bold tracking-wide text-[var(--color-muted)]">RECENT MISTAKES</h3>
          <div className="space-y-2.5">
            {mistakes
              .slice(-10)
              .reverse()
              .map((m, i) => (
                <div key={i} className="rounded-lg border-2 border-[var(--color-ink)] bg-white p-4">
                  <p className="font-mono text-sm font-bold text-[var(--color-ink)]">{m.question}</p>
                  <p className="mt-1.5 font-mono text-xs text-[var(--color-ink)]">
                    You said <span className="font-bold text-[var(--color-red)]">{m.selected_answer}</span> -- correct
                    was <span className="font-bold text-[var(--color-green)]">{m.correct_answer}</span>
                  </p>
                  <p className="mt-1.5 font-mono text-xs text-[var(--color-muted)]">{m.explanation}</p>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
