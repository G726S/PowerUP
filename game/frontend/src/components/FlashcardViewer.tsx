import { useEffect, useMemo, useState } from "react";
import * as api from "../api/client";
import type { Flashcard, Meme } from "../types";
import { ChevronLeftIcon, SpinnerIcon } from "./icons";

interface FlashcardViewerProps {
  chapterId: string;
}

type Slide =
  | { kind: "card"; card: Flashcard; cardNumber: number; totalCards: number }
  | { kind: "meme"; meme: Meme };

const MEME_EVERY = 5;

function buildSlides(cards: Flashcard[], memes: Meme[]): Slide[] {
  const slides: Slide[] = [];
  let memeIndex = 0;
  cards.forEach((card, i) => {
    slides.push({ kind: "card", card, cardNumber: i + 1, totalCards: cards.length });
    const isBreakpoint = (i + 1) % MEME_EVERY === 0 && i + 1 < cards.length;
    if (isBreakpoint && memeIndex < memes.length) {
      slides.push({ kind: "meme", meme: memes[memeIndex] });
      memeIndex++;
    }
  });
  return slides;
}

export function FlashcardViewer({ chapterId }: FlashcardViewerProps) {
  const [cards, setCards] = useState<Flashcard[] | null>(null);
  const [memes, setMemes] = useState<Meme[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [brokenMemeUrls, setBrokenMemeUrls] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setCards(null);
    setMemes([]);
    setError(null);
    setIndex(0);
    setFlipped(false);
    api
      .getFlashcards(chapterId)
      .then(async (data) => {
        if (cancelled) return;
        setCards(data);
        const breaks = Math.max(0, Math.floor((data.length - 1) / MEME_EVERY));
        if (breaks === 0) return;
        const fetched = await Promise.all(
          Array.from({ length: breaks }, () => api.getMeme().catch(() => null)),
        );
        if (!cancelled) setMemes(fetched.filter((m): m is Meme => m !== null));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load flashcards.");
      });
    return () => {
      cancelled = true;
    };
  }, [chapterId]);

  const slides = useMemo(() => buildSlides(cards ?? [], memes), [cards, memes]);

  if (error) {
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-red-soft)] p-8 text-center font-mono text-sm text-[var(--color-ink)]">
        {error}
      </div>
    );
  }

  if (!cards) {
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-cream)] p-8 text-center">
        <SpinnerIcon className="h-6 w-6 text-[var(--color-ink)]" />
        <p className="font-mono text-sm font-bold text-[var(--color-ink)]">GENERATING FLASHCARDS…</p>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-cream)] p-8 text-center font-mono text-sm text-[var(--color-ink)]">
        No flashcards available for this chapter.
      </div>
    );
  }

  function goTo(next: number) {
    setIndex(Math.max(0, Math.min(slides.length - 1, next)));
    setFlipped(false);
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Wheel track -- a full-width strip of every card (and the occasional
          meme break), shifted sideways by index so NEXT/PREV reads as one
          continuous lateral spin rather than an instant swap. */}
      <div className="w-full overflow-hidden rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-cream)]">
        <div
          className="flex"
          style={{
            transform: `translateX(-${index * 100}%)`,
            transition: "transform 420ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          {slides.map((slide, i) => {
            const isActive = i === index;
            if (slide.kind === "meme") {
              const broken = brokenMemeUrls.has(slide.meme.url);
              return (
                <div
                  key={`meme-${slide.meme.url}`}
                  tabIndex={-1}
                  aria-hidden={!isActive}
                  className="flex min-h-[320px] w-full shrink-0 flex-col items-center justify-center gap-3 p-8 text-center"
                >
                  <span className="font-mono text-xs font-bold tracking-wide text-[var(--color-muted)]">
                    MEME BREAK 🎉
                  </span>
                  {broken ? (
                    <p className="font-mono text-sm text-[var(--color-muted)]">Couldn't load this one -- keep going!</p>
                  ) : (
                    <img
                      src={slide.meme.url}
                      alt={slide.meme.title}
                      className="max-h-52 max-w-full rounded border-2 border-[var(--color-ink)] object-contain"
                      loading={isActive ? "eager" : "lazy"}
                      onError={() => setBrokenMemeUrls((prev) => new Set(prev).add(slide.meme.url))}
                    />
                  )}
                  <p className="font-mono text-xs text-[var(--color-muted)]">
                    {slide.meme.title} · r/{slide.meme.subreddit}
                  </p>
                </div>
              );
            }

            const showBack = isActive && flipped;
            return (
              <button
                key={slide.card.id}
                type="button"
                tabIndex={isActive ? 0 : -1}
                aria-hidden={!isActive}
                onClick={() => isActive && setFlipped((f) => !f)}
                className="flex min-h-[320px] w-full shrink-0 flex-col items-center justify-center gap-6 p-8 text-center transition-colors hover:bg-[var(--color-yellow)]/30"
              >
                <span className="font-mono text-xs font-bold tracking-wide text-[var(--color-muted)]">
                  CARD {String(slide.cardNumber).padStart(2, "0")}/{String(slide.totalCards).padStart(2, "0")}
                  {showBack ? " · ANSWER" : ""}
                </span>
                <p className="font-serif text-2xl font-bold leading-snug text-[var(--color-ink)] md:text-3xl">
                  {showBack ? slide.card.back : slide.card.front}
                </p>
                <span className="font-mono text-xs text-[var(--color-muted)]">
                  {showBack ? "CLICK TO SEE QUESTION" : "CLICK TO REVEAL ANSWER"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
          aria-label="Previous card"
          className="inline-flex items-center gap-1 rounded-lg border-2 border-[var(--color-ink)] bg-white px-4 py-2 font-mono text-sm font-bold text-[var(--color-ink)] shadow-[var(--shadow-brutal-sm)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[var(--shadow-brutal-md)] active:translate-x-0 active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-[var(--shadow-brutal-sm)]"
        >
          <ChevronLeftIcon />
          PREV
        </button>
        <div className="flex items-center gap-1.5">
          {slides.map((slide, i) => {
            const isMeme = slide.kind === "meme";
            const isCurrent = i === index;
            return (
              <span
                key={isMeme ? `meme-${slide.meme.url}` : slide.card.id}
                className={`h-2 w-2 border border-[var(--color-ink)] transition-all ${isMeme ? "rounded-sm" : "rounded-full"} ${
                  isCurrent
                    ? `scale-125 ${isMeme ? "bg-[var(--color-yellow)]" : "bg-[var(--color-pink)]"}`
                    : isMeme
                      ? "bg-[var(--color-yellow)]/40"
                      : "bg-white"
                }`}
              />
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => goTo(index + 1)}
          disabled={index === slides.length - 1}
          aria-label="Next card"
          className="inline-flex items-center gap-1 rounded-lg border-2 border-[var(--color-ink)] bg-white px-4 py-2 font-mono text-sm font-bold text-[var(--color-ink)] shadow-[var(--shadow-brutal-sm)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[var(--shadow-brutal-md)] active:translate-x-0 active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-[var(--shadow-brutal-sm)]"
        >
          NEXT
          <ChevronLeftIcon className="h-4 w-4 rotate-180" />
        </button>
      </div>
    </div>
  );
}
