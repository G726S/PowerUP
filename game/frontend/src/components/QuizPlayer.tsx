import { useEffect, useState } from "react";
import * as api from "../api/client";
import { usePoints } from "../hooks/usePoints";
import type { QuizQuestion } from "../types";
import { CheckIcon, CoinIcon, SpinnerIcon, XIcon } from "./icons";

interface QuizPlayerProps {
  chapterId: string;
  onClose: () => void;
  onCompleted: () => void;
}

const LETTERS = ["A", "B", "C", "D"];
const POINTS_PER_CORRECT_ANSWER = 10;

export function QuizPlayer({ chapterId, onClose, onCompleted }: QuizPlayerProps) {
  const { award } = usePoints();
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .startQuiz(chapterId)
      .then((data) => {
        if (!cancelled) setQuestions(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't generate a quiz.");
      });
    return () => {
      cancelled = true;
    };
  }, [chapterId]);

  function selectAnswer(i: number) {
    if (selected !== null || !questions) return;
    setSelected(i);
    if (i === questions[index].correct_index) {
      setScore((s) => s + 1);
      award(POINTS_PER_CORRECT_ANSWER).catch(() => {
        // balance just won't reflect this answer until the next refresh
      });
    }
  }

  function next() {
    if (!questions) return;
    if (index + 1 < questions.length) {
      setIndex((i) => i + 1);
      setSelected(null);
    } else {
      setFinished(true);
    }
  }

  async function handleDone() {
    setIsCompleting(true);
    try {
      await api.completeChapter(chapterId);
      onCompleted();
    } finally {
      setIsCompleting(false);
    }
  }

  return (
    <div className="flex min-h-[320px] flex-col rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-cream)] p-6">
      <div className="mb-4 flex items-center justify-between">
        <span className="font-mono text-xs font-bold tracking-wide text-[var(--color-muted)]">QUIZ</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close quiz"
          className="rounded border-2 border-transparent p-1 text-[var(--color-ink)] hover:border-[var(--color-ink)] hover:bg-white"
        >
          <XIcon />
        </button>
      </div>

      {error && (
        <div className="flex flex-1 items-center justify-center text-center font-mono text-sm text-[var(--color-ink)]">
          {error}
        </div>
      )}

      {!error && !questions && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <SpinnerIcon className="h-6 w-6 text-[var(--color-ink)]" />
          <p className="font-mono text-sm font-bold text-[var(--color-ink)]">GENERATING QUIZ…</p>
        </div>
      )}

      {questions && !finished && (
        <div className="flex flex-1 flex-col gap-5">
          <span className="font-mono text-xs font-bold text-[var(--color-muted)]">
            QUESTION {index + 1}/{questions.length}
          </span>
          <p className="font-serif text-xl font-bold leading-snug text-[var(--color-ink)] md:text-2xl">
            {questions[index].text}
          </p>
          <div className="grid gap-2.5">
            {questions[index].options.map((option, i) => {
              const isCorrect = i === questions[index].correct_index;
              const isSelected = i === selected;
              const revealed = selected !== null;
              let stateClasses = "border-[var(--color-ink)] bg-white hover:bg-[var(--color-yellow)]/30";
              if (revealed && isCorrect) stateClasses = "border-[var(--color-ink)] bg-[var(--color-green-soft)]";
              else if (revealed && isSelected && !isCorrect) stateClasses = "border-[var(--color-ink)] bg-[var(--color-red-soft)]";
              else if (revealed) stateClasses = "border-[var(--color-ink)] bg-white opacity-60";

              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectAnswer(i)}
                  disabled={revealed}
                  className={`flex items-center gap-3 rounded-lg border-2 px-4 py-3 text-left font-mono text-sm text-[var(--color-ink)] transition-colors disabled:cursor-default ${stateClasses}`}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded border-2 border-[var(--color-ink)] font-bold">
                    {LETTERS[i]}
                  </span>
                  <span className="flex-1">{option}</span>
                  {revealed && isCorrect && <CheckIcon className="h-4 w-4 shrink-0" />}
                  {revealed && isSelected && !isCorrect && <XIcon className="h-4 w-4 shrink-0" />}
                </button>
              );
            })}
          </div>

          {selected !== null && (
            <div className="rounded-lg border-2 border-[var(--color-ink)] bg-white p-4 font-mono text-sm text-[var(--color-ink)]">
              {questions[index].explanation}
            </div>
          )}

          <div className="mt-auto flex justify-end">
            <button
              type="button"
              onClick={next}
              disabled={selected === null}
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-pink)] px-5 py-2.5 font-mono text-sm font-bold text-white shadow-[var(--shadow-brutal-sm)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[var(--shadow-brutal-md)] active:translate-x-0 active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-[var(--shadow-brutal-sm)]"
            >
              {index + 1 < questions.length ? "NEXT" : "FINISH"}
            </button>
          </div>
        </div>
      )}

      {questions && finished && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <span className="font-mono text-xs font-bold tracking-wide text-[var(--color-muted)]">
            QUIZ COMPLETE
          </span>
          <p className="font-serif text-3xl font-bold text-[var(--color-ink)]">
            {score}/{questions.length} correct
          </p>
          <span className="flex items-center gap-1.5 rounded-lg border-2 border-[var(--color-ink)] bg-white px-3 py-1.5 font-mono text-sm font-bold text-[var(--color-ink)]">
            <CoinIcon className="h-4 w-4 text-[var(--color-orange)]" />+{score * POINTS_PER_CORRECT_ANSWER} points earned
          </span>
          <button
            type="button"
            onClick={handleDone}
            disabled={isCompleting}
            className="inline-flex items-center gap-1.5 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-pink)] px-5 py-2.5 font-mono text-sm font-bold text-white shadow-[var(--shadow-brutal-sm)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[var(--shadow-brutal-md)] active:translate-x-0 active:translate-y-0 active:shadow-none disabled:opacity-60"
          >
            {isCompleting && <SpinnerIcon className="h-3.5 w-3.5" />}
            DONE
          </button>
        </div>
      )}
    </div>
  );
}
