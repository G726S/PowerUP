import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookIcon, PlayIcon } from "../components/icons";

interface LandingPageProps {
  onDismiss: () => void;
}

interface Floater {
  glyph: string;
  top: string;
  left: string;
  size: string;
  delay: string;
  duration: string;
  rotate: string;
}

const FLOATERS: Floater[] = [
  { glyph: "\u{1F4D6}", top: "16%", left: "9%", size: "48px", delay: "0s", duration: "5.2s", rotate: "-8deg" },
  { glyph: "\u{1F412}", top: "66%", left: "11%", size: "58px", delay: "0.5s", duration: "4.4s", rotate: "6deg" },
  { glyph: "\u{1F34C}", top: "22%", left: "88%", size: "40px", delay: "0.9s", duration: "5.6s", rotate: "-14deg" },
  { glyph: "\u{2694}\u{FE0F}", top: "70%", left: "87%", size: "46px", delay: "0.2s", duration: "4.8s", rotate: "10deg" },
  { glyph: "\u{1F34C}", top: "84%", left: "48%", size: "30px", delay: "1.2s", duration: "6s", rotate: "18deg" },
  { glyph: "\u{1F5E1}\u{FE0F}", top: "10%", left: "48%", size: "32px", delay: "0.7s", duration: "5s", rotate: "-4deg" },
];

export function LandingPage({ onDismiss }: LandingPageProps) {
  const [leaving, setLeaving] = useState(false);
  const dismissed = useRef(false);
  const navigate = useNavigate();

  // Always land on the course list, never wherever the URL happened to
  // point (e.g. a course page from before a reload) -- navigate right away
  // so the correct page is already underneath by the time the landing
  // page finishes sliding off, not just whatever page was there before.
  function dismiss() {
    if (dismissed.current) return;
    dismissed.current = true;
    navigate("/");
    setLeaving(true);
    window.setTimeout(onDismiss, 650);
  }

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", dismiss);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", dismiss);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleInteract() {
    dismiss();
  }

  return (
    <div
      onClick={handleInteract}
      onWheel={handleInteract}
      onTouchStart={handleInteract}
      className={`fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center overflow-hidden bg-[var(--color-cream)] transition-transform duration-[650ms] ease-[cubic-bezier(.65,0,.35,1)] ${
        leaving ? "-translate-y-full" : "translate-y-0"
      }`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(var(--color-ink) 1px, transparent 1px), linear-gradient(90deg, var(--color-ink) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      {FLOATERS.map((f, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="pointer-events-none absolute select-none"
          style={
            {
              top: f.top,
              left: f.left,
              fontSize: f.size,
              animation: `landing-float ${f.duration} ease-in-out ${f.delay} infinite`,
              "--rot": f.rotate,
            } as React.CSSProperties
          }
        >
          {f.glyph}
        </span>
      ))}

      <div className="relative z-10 flex w-full max-w-xl flex-col items-center px-6 text-center">
        <span className="mb-5 inline-flex items-center gap-2 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-yellow)] px-3 py-1.5 font-mono text-xs font-bold tracking-wide text-[var(--color-ink)] shadow-[var(--shadow-brutal-sm)]">
          <BookIcon className="h-3.5 w-3.5" />
          BRAINQUEST
        </span>

        <h1 className="font-serif text-4xl font-bold leading-tight text-[var(--color-ink)] sm:text-5xl md:text-6xl">
          Study hard.
          <br />
          Power up.
        </h1>

        <p className="mt-5 font-mono text-sm text-[var(--color-muted)] sm:text-base">
          Upload your course notes, master them with flashcards and quizzes, earn points -- then spend them
          arming a samurai or sending a monkey climbing for bananas.
        </p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
          <span className="rounded-lg border-2 border-[var(--color-ink)] bg-white px-3 py-1.5 font-mono text-xs font-bold text-[var(--color-ink)]">
            {"\u{1F4D6}"} STUDY
          </span>
          <span className="rounded-lg border-2 border-[var(--color-ink)] bg-white px-3 py-1.5 font-mono text-xs font-bold text-[var(--color-ink)]">
            {"\u{26A1}"} EARN POINTS
          </span>
          <span className="rounded-lg border-2 border-[var(--color-ink)] bg-white px-3 py-1.5 font-mono text-xs font-bold text-[var(--color-ink)]">
            {"\u{2694}\u{FE0F}"} BATTLE
          </span>
          <span className="rounded-lg border-2 border-[var(--color-ink)] bg-white px-3 py-1.5 font-mono text-xs font-bold text-[var(--color-ink)]">
            {"\u{1F412}"} CLIMB
          </span>
        </div>

        <button
          type="button"
          onClick={handleInteract}
          className="mt-9 inline-flex items-center gap-2 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-pink)] px-7 py-3.5 font-mono text-base font-bold text-white shadow-[var(--shadow-brutal-md)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[var(--shadow-brutal-lg)] active:translate-x-0 active:translate-y-0 active:shadow-none"
        >
          <PlayIcon className="h-4 w-4" />
          PRESS START
        </button>

        <p
          className="mt-4 font-mono text-xs text-[var(--color-muted)]"
          style={{ animation: "landing-blink 1.6s ease-in-out infinite" }}
        >
          SCROLL, CLICK, OR PRESS ANY KEY
        </p>
      </div>
    </div>
  );
}
