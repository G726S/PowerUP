import { useCallback, useEffect, useState } from "react";
import * as api from "../api/client";
import { useSessionId } from "../session/SessionContext";
import type { MCQ } from "../types";
import { CheckIcon, SpinnerIcon, XIcon, ZapIcon } from "./icons";

interface McqOverlayProps {
  courseId: string;
  /** Called after a question is answered, with whether it was correct --
   * the caller (the game) decides what that's worth (energy, score, etc). */
  onAnswered: (isCorrect: boolean) => void;
  onClose: () => void;
  /** When true, this wasn't opened voluntarily -- energy ran out, so there's
   * nothing to "go back to" until a correct answer refuels it. Hides the
   * dismiss affordances instead of leaving them present but silently
   * no-op'd (the caller's onClose still ignores a close attempt while
   * energy is at zero either way -- this just makes that visible). */
  forced?: boolean;
  /** Leaves the game entirely (back to the lobby) -- offered specifically
   * while forced, so a run of wrong answers never actually traps someone
   * with no way out at all. Distinct from onClose: this abandons the
   * session instead of resuming play with zero energy. */
  onExitGame?: () => void;
}

const LETTERS = ["A", "B", "C", "D"];

type Phase =
  | { kind: "loading" }
  | { kind: "question"; question: MCQ }
  | { kind: "answered"; question: MCQ; selected: string; isCorrect: boolean; explanation: string }
  | { kind: "mastered"; message: string }
  | { kind: "empty" }
  | { kind: "error"; message: string };

/** A focused MCQ modal meant to sit on top of something else (a game) --
 * no power-meter/round-management chrome of its own. It answers one
 * question at a time and reports correct/incorrect
 * back to the caller; the caller owns what happens next. */
export function McqOverlay({ courseId, onAnswered, onClose, forced = false, onExitGame }: McqOverlayProps) {
  const sessionId = useSessionId();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  const loadNext = useCallback(async () => {
    setPhase({ kind: "loading" });
    try {
      const data = await api.getNextQuestion(sessionId, courseId);
      if (data.mastered) {
        setPhase({ kind: "mastered", message: data.message ?? "This course is mastered!" });
        return;
      }
      if (data.question) {
        setPhase({ kind: "question", question: data.question });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Couldn't load a question.";
      if (message.toLowerCase().includes("round complete") || message.toLowerCase().includes("no questions available")) {
        setPhase({ kind: "empty" });
      } else {
        setPhase({ kind: "error", message });
      }
    }
  }, [sessionId, courseId]);

  useEffect(() => {
    loadNext();
  }, [loadNext]);

  async function selectAnswer(letter: string) {
    if (phase.kind !== "question") return;
    const q = phase.question;
    try {
      const result = await api.submitAnswer({
        session_id: sessionId,
        course_id: courseId,
        question_id: q.question_id,
        question: q.question,
        selected_answer: letter,
        correct_answer: q.correct_answer,
        explanation: q.explanation,
        difficulty: q.difficulty,
        topic: q.topic,
      });
      setPhase({
        kind: "answered",
        question: q,
        selected: letter,
        isCorrect: result.is_correct,
        explanation: result.explanation,
      });
      onAnswered(result.is_correct);
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "Couldn't submit that answer." });
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-cream)] shadow-[var(--shadow-brutal-lg)]">
        <div className="flex items-center justify-between border-b-2 border-[var(--color-ink)] bg-[var(--color-yellow)] px-5 py-3">
          <span className="flex items-center gap-1.5 font-mono text-xs font-bold tracking-wide text-[var(--color-ink)]">
            <ZapIcon className="h-3.5 w-3.5" />
            {forced ? "OUT OF ENERGY -- ANSWER TO KEEP GOING" : "ANSWER TO REFUEL"}
          </span>
          {!forced && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded border-2 border-transparent p-1 text-[var(--color-ink)] hover:border-[var(--color-ink)] hover:bg-white"
            >
              <XIcon />
            </button>
          )}
          {forced && onExitGame && (
            <button
              type="button"
              onClick={onExitGame}
              className="rounded border-2 border-[var(--color-ink)] bg-white px-2.5 py-1 font-mono text-[10px] font-bold text-[var(--color-ink)] hover:bg-[var(--color-red-soft)]"
            >
              EXIT GAME
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {phase.kind === "loading" && (
            <div className="flex min-h-[180px] items-center justify-center">
              <SpinnerIcon className="h-6 w-6 text-[var(--color-ink)]" />
            </div>
          )}

          {phase.kind === "error" && (
            <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 text-center">
              <p className="font-mono text-sm text-[var(--color-ink)]">{phase.message}</p>
              <button
                type="button"
                onClick={loadNext}
                className="rounded-lg border-2 border-[var(--color-ink)] bg-white px-4 py-2 font-mono text-sm font-bold text-[var(--color-ink)] shadow-[var(--shadow-brutal-sm)]"
              >
                RETRY
              </button>
            </div>
          )}

          {phase.kind === "empty" && (
            <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 text-center">
              <p className="font-mono text-sm font-bold text-[var(--color-ink)]">
                No fresh questions left this session.
              </p>
              <p className="font-mono text-xs text-[var(--color-muted)]">Close this and keep climbing -- more will be ready next session.</p>
            </div>
          )}

          {phase.kind === "mastered" && (
            <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 text-center">
              <p className="font-mono text-sm font-bold text-[var(--color-ink)]">{phase.message}</p>
            </div>
          )}

          {(phase.kind === "question" || phase.kind === "answered") && (
            <div className="flex flex-col gap-4">
              <p className="font-serif text-lg font-bold leading-snug text-[var(--color-ink)]">
                {phase.question.question}
              </p>
              <div className="grid gap-2">
                {phase.question.options.map((option, i) => {
                  const letter = LETTERS[i];
                  const isAnswered = phase.kind === "answered";
                  const isCorrectAnswer = letter === phase.question.correct_answer;
                  const isSelected = isAnswered && letter === phase.selected;
                  let stateClasses = "border-[var(--color-ink)] bg-white hover:bg-[var(--color-yellow)]/30";
                  if (isAnswered && isCorrectAnswer) stateClasses = "border-[var(--color-ink)] bg-[var(--color-green-soft)]";
                  else if (isAnswered && isSelected) stateClasses = "border-[var(--color-ink)] bg-[var(--color-red-soft)]";
                  else if (isAnswered) stateClasses = "border-[var(--color-ink)] bg-white opacity-60";

                  return (
                    <button
                      key={letter}
                      type="button"
                      onClick={() => selectAnswer(letter)}
                      disabled={isAnswered}
                      className={`flex items-center gap-2.5 rounded-lg border-2 px-3.5 py-2.5 text-left font-mono text-sm text-[var(--color-ink)] transition-colors disabled:cursor-default ${stateClasses}`}
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 border-[var(--color-ink)] text-xs font-bold">
                        {letter}
                      </span>
                      <span className="flex-1">{option}</span>
                      {isAnswered && isCorrectAnswer && <CheckIcon className="h-4 w-4 shrink-0" />}
                      {isAnswered && isSelected && !isCorrectAnswer && <XIcon className="h-4 w-4 shrink-0" />}
                    </button>
                  );
                })}
              </div>

              {phase.kind === "answered" && (
                <>
                  <div
                    className={`rounded-lg border-2 border-[var(--color-ink)] p-3 font-mono text-sm text-[var(--color-ink)] ${
                      phase.isCorrect ? "bg-[var(--color-green-soft)]" : "bg-white"
                    }`}
                  >
                    {phase.isCorrect ? "+250 ENERGY -- " : ""}
                    {phase.explanation}
                  </div>
                  <div className="flex justify-end gap-2.5">
                    {/* Once forced, "back to game" only actually works again
                        once a correct answer has refueled past zero -- no
                        point showing it while a wrong answer left energy at
                        zero, since the caller would just ignore the click. */}
                    {(!forced || phase.isCorrect) && (
                      <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg border-2 border-[var(--color-ink)] bg-white px-4 py-2.5 font-mono text-sm font-bold text-[var(--color-ink)] shadow-[var(--shadow-brutal-sm)]"
                      >
                        BACK TO GAME
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={loadNext}
                      className="inline-flex items-center gap-1.5 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-pink)] px-4 py-2.5 font-mono text-sm font-bold text-white shadow-[var(--shadow-brutal-sm)]"
                    >
                      ANOTHER QUESTION
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
