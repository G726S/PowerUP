import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "../api/client";
import { useSessionId } from "../session/SessionContext";
import type { Flashcard, Meme } from "../types";
import { ChevronLeftIcon, SpinnerIcon } from "./icons";

interface FlashcardViewerProps {
  courseId: string;
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

export function FlashcardViewer({ courseId, chapterId }: FlashcardViewerProps) {
  const sessionId = useSessionId();
  const [cards, setCards] = useState<Flashcard[] | null>(null);
  const [status, setStatus] = useState<string>("processing");
  const [memes, setMemes] = useState<Meme[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [instantJump, setInstantJump] = useState(false);
  const [brokenMemeUrls, setBrokenMemeUrls] = useState<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCards(null);
    setStatus("processing");
    setMemes([]);
    setError(null);
    setIndex(0);
    setFlipped(false);

    async function poll() {
      try {
        const data = await api.getFlashcards(sessionId, courseId, chapterId);
        if (cancelled) return;
        setStatus(data.status);
        setCards(data.flashcards);
        if (data.status === "processing") {
          pollRef.current = setTimeout(poll, 3000);
          return;
        }
        const breaks = Math.max(0, Math.floor((data.flashcards.length - 1) / MEME_EVERY));
        if (breaks === 0) return;
        const fetched = await Promise.all(Array.from({ length: breaks }, () => api.getMeme().catch(() => null)));
        if (!cancelled) setMemes(fetched.filter((m): m is Meme => m !== null));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load flashcards.");
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [sessionId, courseId, chapterId]);

  const slides = useMemo(() => buildSlides(cards ?? [], memes), [cards, memes]);

  if (error) {
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-red-soft)] p-8 text-center font-mono text-sm text-[var(--color-ink)]">
        {error}
      </div>
    );
  }

  if (cards === null || status === "processing") {
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
    // goTo is only ever called with index-1 or index+1, so "next" landing
    // outside the array means the caller stepped past an end -- loop to
    // the other end instead of clamping/disabling. Snap instantly rather
    // than sliding the wheel all the way across every card in between.
    const wrapsForward = next >= slides.length;
    const wrapsBackward = next < 0;
    const target = wrapsForward ? 0 : wrapsBackward ? slides.length - 1 : next;
    if (wrapsForward || wrapsBackward) {
      setInstantJump(true);
      setIndex(target);
      setFlipped(false);
      requestAnimationFrame(() => requestAnimationFrame(() => setInstantJump(false)));
    } else {
      setIndex(target);
      setFlipped(false);
    }
  }

  const currentSlide = slides[index];

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Wheel track -- a full-width strip of every card (and the occasional
          meme break), shifted sideways by index so NEXT/PREV reads as one
          continuous lateral spin rather than an instant swap. No border/
          background of its own -- each slide draws its own single box, so
          there's never a box visibly nested inside another one. */}
      <div className="w-full overflow-hidden rounded-lg">
        <div
          className="flex"
          style={{
            transform: `translateX(-${index * 100}%)`,
            transition: instantJump ? "none" : "transform 420ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          {slides.map((slide, i) => {
            const isActive = i === index;
            if (slide.kind === "meme") {
              const broken = brokenMemeUrls.has(slide.meme.url);
              return (
                <div
                  key={`slide-${i}`}
                  tabIndex={-1}
                  aria-hidden={!isActive}
                  className="flex min-h-[360px] w-full shrink-0 flex-col items-center justify-center gap-3 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-cream)] p-8 text-center"
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

            const isFlipped = isActive && flipped;
            return (
              <div key={`slide-${i}`} className="w-full shrink-0" style={{ perspective: "1400px" }}>
                {/* This single element IS the card -- border/background/shadow
                    live here and rotate as one physical box (not floating text
                    over a separate frame), filling the slide slot edge to edge
                    instead of sitting as a smaller box inside a bigger one. */}
                <button
                  type="button"
                  tabIndex={isActive ? 0 : -1}
                  aria-hidden={!isActive}
                  onClick={() => isActive && setFlipped((f) => !f)}
                  onMouseEnter={() => setIsHovering(true)}
                  onMouseLeave={() => setIsHovering(false)}
                  className="relative min-h-[360px] w-full"
                  style={{
                    transformStyle: "preserve-3d",
                    transition: "transform 480ms cubic-bezier(0.4, 0.2, 0.2, 1)",
                    transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
                  }}
                >
                  {/* front -- tint driven by real isHovering state, not CSS
                      :hover: the flip swaps which face is topmost under an
                      UNMOVED cursor, and browsers only re-evaluate :hover on
                      an actual mousemove, so a plain hover: class silently
                      stops applying to the newly-front face right after the
                      click that revealed it. */}
                  <div
                    className={`absolute inset-0 flex flex-col items-center justify-center gap-6 overflow-y-auto rounded-lg border-2 border-[var(--color-ink)] p-8 text-center shadow-[var(--shadow-brutal-sm)] transition-colors ${
                      isActive && isHovering ? "bg-[var(--color-yellow)]/20" : "bg-white"
                    }`}
                    style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
                  >
                    <p className="break-words font-serif text-xl font-bold leading-snug text-[var(--color-ink)] md:text-2xl">
                      {slide.card.front}
                    </p>
                    <span className="font-mono text-xs text-[var(--color-muted)]">CLICK TO REVEAL ANSWER</span>
                  </div>
                  {/* back -- same overflow-y-auto safety net: a long answer
                      scrolls inside the card instead of spilling past its
                      edges, so the box never grows or gets crossed by text. */}
                  <div
                    className={`absolute inset-0 flex flex-col items-center justify-center gap-6 overflow-y-auto rounded-lg border-2 border-[var(--color-ink)] p-8 text-center shadow-[var(--shadow-brutal-sm)] transition-colors ${
                      isActive && isHovering ? "bg-[var(--color-yellow)]/20" : "bg-white"
                    }`}
                    style={{
                      backfaceVisibility: "hidden",
                      WebkitBackfaceVisibility: "hidden",
                      transform: "rotateY(180deg)",
                    }}
                  >
                    <p className="break-words font-serif text-xl font-bold leading-snug text-[var(--color-ink)] md:text-2xl">
                      {slide.card.back}
                    </p>
                    <span className="font-mono text-xs text-[var(--color-muted)]">CLICK TO SEE QUESTION</span>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => goTo(index - 1)}
          aria-label="Previous card"
          className="inline-flex items-center gap-1 rounded-lg border-2 border-[var(--color-ink)] bg-white px-4 py-2 font-mono text-sm font-bold text-[var(--color-ink)] shadow-[var(--shadow-brutal-sm)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[var(--shadow-brutal-md)] active:translate-x-0 active:translate-y-0 active:shadow-none"
        >
          <ChevronLeftIcon />
          PREV
        </button>
        <span className="min-w-[64px] text-center font-mono text-sm font-bold text-[var(--color-ink)]">
          {currentSlide?.kind === "card" ? `${currentSlide.cardNumber} / ${currentSlide.totalCards}` : "🎉"}
        </span>
        <button
          type="button"
          onClick={() => goTo(index + 1)}
          aria-label="Next card"
          className="inline-flex items-center gap-1 rounded-lg border-2 border-[var(--color-ink)] bg-white px-4 py-2 font-mono text-sm font-bold text-[var(--color-ink)] shadow-[var(--shadow-brutal-sm)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[var(--shadow-brutal-md)] active:translate-x-0 active:translate-y-0 active:shadow-none"
        >
          NEXT
          <ChevronLeftIcon className="h-4 w-4 rotate-180" />
        </button>
      </div>
    </div>
  );
}
