import { useRef, useState } from "react";
import { MonkeyGame } from "./MonkeyGame";
import { SamuraiHordeGame } from "./SamuraiHordeGame";
import { PlayIcon } from "./icons";

interface GameLobbyProps {
  courseId: string;
}

/** Shown when the student clicks PLAY -- a choice of games instead of
 * dropping straight into one.
 *
 * This component owns one persistent container div for ALL of the lobby
 * and every game -- fullscreen has to be requested synchronously inside
 * the click handler that launches a game (browsers reject
 * requestFullscreen() called later from an effect, since by then the
 * user-gesture window has closed), and the fullscreen element can't be
 * swapped out for a different one without the browser auto-exiting
 * fullscreen. So the same div stays mounted the whole time; only what's
 * rendered inside it changes. */
const DURATION_OPTIONS = [5, 10, 15] as const;

export function GameLobby({ courseId }: GameLobbyProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeGame, setActiveGame] = useState<"monkey" | "horde" | null>(null);
  const [durationMinutes, setDurationMinutes] = useState<(typeof DURATION_OPTIONS)[number]>(10);

  async function launchGame(game: "monkey" | "horde") {
    try {
      await containerRef.current?.requestFullscreen?.();
    } catch {
      // fullscreen denied/unsupported -- the game still works windowed
    }
    setActiveGame(game);
  }

  function exitGame() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setActiveGame(null);
  }

  return (
    <div ref={containerRef} className={activeGame ? "fixed inset-0 z-[60] bg-[#7ec8e3]" : ""}>
      {activeGame === "monkey" ? (
        <MonkeyGame courseId={courseId} onExit={exitGame} sessionSeconds={durationMinutes * 60} />
      ) : activeGame === "horde" ? (
        <SamuraiHordeGame courseId={courseId} onExit={exitGame} sessionSeconds={durationMinutes * 60} />
      ) : (
        <div className="flex min-h-[420px] flex-col items-center justify-center gap-8 py-8">
          <div className="text-center">
            <h2 className="font-serif text-2xl font-bold text-[var(--color-ink)]">Choose a game</h2>
            <p className="mt-1 font-mono text-sm text-[var(--color-muted)]">
              Every game runs the same way: a timer, an energy meter your moves spend, and MCQs that refuel it.
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] font-bold text-[var(--color-muted)]">SESSION MINUTES</span>
            {DURATION_OPTIONS.map((mins) => (
              <button
                key={mins}
                type="button"
                onClick={() => setDurationMinutes(mins)}
                className={`rounded border-2 border-[var(--color-ink)] px-2.5 py-1 font-mono text-xs font-bold transition-colors ${
                  durationMinutes === mins ? "bg-[var(--color-ink)] text-white" : "bg-white text-[var(--color-ink)] hover:bg-[var(--color-cream)]"
                }`}
              >
                {mins}
              </button>
            ))}
          </div>

          <div className="grid w-full max-w-2xl grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-[var(--color-ink)] bg-white p-6 text-center shadow-[var(--shadow-brutal-md)]">
              <div className="flex h-16 w-16 items-center justify-center rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-yellow)] text-3xl">
                🐒
              </div>
              <div>
                <h3 className="font-mono text-base font-bold uppercase text-[var(--color-ink)]">Monkey Climb</h3>
                <p className="mt-1 font-mono text-xs text-[var(--color-muted)]">
                  Climb as high as you can. Falling sends you back to the start -- answer questions to refuel.
                </p>
              </div>

              <button
                type="button"
                onClick={() => launchGame("monkey")}
                className="inline-flex items-center gap-1.5 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-pink)] px-4 py-2 font-mono text-xs font-bold text-white shadow-[var(--shadow-brutal-sm)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[var(--shadow-brutal-md)]"
              >
                <PlayIcon className="h-3.5 w-3.5" />
                PLAY
              </button>
            </div>

            <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-[var(--color-ink)] bg-white p-6 text-center shadow-[var(--shadow-brutal-md)]">
              <div className="flex h-16 w-16 items-center justify-center rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-red-soft)] text-3xl">
                🥷
              </div>
              <div>
                <h3 className="font-mono text-base font-bold uppercase text-[var(--color-ink)]">Samurai Horde</h3>
                <p className="mt-1 font-mono text-xs text-[var(--color-muted)]">
                  Fight off a swarm of respawning samurai at once -- last as long as you can, questions refuel you.
                </p>
              </div>
              <button
                type="button"
                onClick={() => launchGame("horde")}
                className="inline-flex items-center gap-1.5 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-pink)] px-4 py-2 font-mono text-xs font-bold text-white shadow-[var(--shadow-brutal-sm)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[var(--shadow-brutal-md)]"
              >
                <PlayIcon className="h-3.5 w-3.5" />
                PLAY
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
