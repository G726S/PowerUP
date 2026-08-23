import Phaser from "phaser";
import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../api/client";
import { createSamuraiDuel, SamuraiDuelScene } from "../game/SamuraiDuelScene";
import { CORRECT_ANSWER_BONUS, DEFAULT_SESSION_SECONDS, LOW_ENERGY_THRESHOLD, STARTING_ENERGY } from "../lib/gameEconomy";
import { useSessionId } from "../session/SessionContext";
import { McqOverlay } from "./McqOverlay";
import { XIcon, ZapIcon } from "./icons";

interface SamuraiGameProps {
  courseId: string;
  onExit: () => void;
  sessionSeconds?: number;
}

const ATTACK_COST = 90;
const MOVE_COST = 20;
const ROUND_FLASH_MS = 1400;

type Phase = "playing" | "mcq" | "session-end";

/** A lightweight browser-native duel replacing the original teammate-built
 * pygame/WASM version -- that build turned out to hang indefinitely on a
 * pygbag asset-preloader stall in real browsers (not just headless test
 * environments), with no reliable fix available from this side of the
 * loader. Same bridge pattern as MonkeyGame.tsx: the Phaser scene owns the
 * fight/AI, this component owns the shared study-app economy (energy,
 * session timer, MCQ refuel) -- including forcing the MCQ open (rather
 * than resetting progress) when energy hits zero, matching Monkey Climb. */
export function SamuraiGame({ courseId, onExit, sessionSeconds = DEFAULT_SESSION_SECONDS }: SamuraiGameProps) {
  const sessionId = useSessionId();
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<SamuraiDuelScene | null>(null);

  const [energy, setEnergy] = useState(STARTING_ENERGY);
  const [phase, setPhase] = useState<Phase>("playing");
  const [secondsLeft, setSecondsLeft] = useState(sessionSeconds);
  const [stats, setStats] = useState({ answered: 0, correct: 0, wins: 0, losses: 0 });
  const [showLowEnergyToast, setShowLowEnergyToast] = useState(false);
  const [roundBanner, setRoundBanner] = useState<"won" | "lost" | null>(null);
  const wasAboveThreshold = useRef(true);
  const wasPositiveEnergy = useRef(true);
  const phaseRef = useRef<Phase>("playing");
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const handleRoundResult = useCallback((won: boolean) => {
    setRoundBanner(won ? "won" : "lost");
    setTimeout(() => setRoundBanner(null), ROUND_FLASH_MS);
    setStats((s) => ({ ...s, wins: s.wins + (won ? 1 : 0), losses: s.losses + (won ? 0 : 1) }));
    setTimeout(() => {
      if (phaseRef.current === "playing") sceneRef.current?.scene.restart();
    }, ROUND_FLASH_MS);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    // Same StrictMode guard as MonkeyGame -- Phaser's boot is async, so a
    // first (dev-only double-invoked) instance's still-pending "ready"
    // callback could otherwise attach a second live listener set.
    let disposed = false;
    const game = createSamuraiDuel(containerRef.current);
    gameRef.current = game;

    function attach() {
      if (disposed) return;
      const scene = game.scene.getScene("SamuraiDuel") as SamuraiDuelScene;
      sceneRef.current = scene;
      scene.events.on("move-tick", () => setEnergy((e) => Math.max(0, e - MOVE_COST)));
      scene.events.on("attack", () => setEnergy((e) => Math.max(0, e - ATTACK_COST)));
      scene.events.on("round-result", (result: { won: boolean }) => handleRoundResult(result.won));
    }
    game.events.once(Phaser.Core.Events.READY, attach);

    return () => {
      disposed = true;
      game.destroy(true);
      if (gameRef.current === game) gameRef.current = null;
      sceneRef.current = null;
    };
  }, [handleRoundResult]);

  // Running out of energy freezes the duel exactly where it is (scene
  // paused) and forces the MCQ open -- same "the meter is the point of the
  // game" rule as Monkey Climb, not a loss condition of its own.
  useEffect(() => {
    const wasPositive = wasPositiveEnergy.current;
    if (wasPositive && energy <= 0 && phase === "playing") {
      setPhase("mcq");
    }
    wasPositiveEnergy.current = energy > 0;
  }, [energy, phase]);

  useEffect(() => {
    const game = gameRef.current;
    if (!game) return;
    if (phase === "mcq") game.scene.pause("SamuraiDuel");
    else if (phase === "playing") game.scene.resume("SamuraiDuel");
  }, [phase]);

  function handleMcqClose() {
    if (energy > 0) setPhase("playing");
  }

  useEffect(() => {
    if (phase === "session-end") return;
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          setPhase("session-end");
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    const wasAbove = wasAboveThreshold.current;
    const isAbove = energy > LOW_ENERGY_THRESHOLD;
    if (wasAbove && !isAbove) {
      setShowLowEnergyToast(true);
      setTimeout(() => setShowLowEnergyToast(false), 4000);
    }
    wasAboveThreshold.current = isAbove;
  }, [energy]);

  useEffect(() => {
    api.endRound(sessionId, courseId).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleAnswered(isCorrect: boolean) {
    setStats((s) => ({ ...s, answered: s.answered + 1, correct: s.correct + (isCorrect ? 1 : 0) }));
    if (isCorrect) setEnergy((e) => e + CORRECT_ANSWER_BONUS);
  }

  async function handlePlayAgain() {
    await api.endRound(sessionId, courseId).catch(() => {});
    setEnergy(STARTING_ENERGY);
    setSecondsLeft(sessionSeconds);
    setStats({ answered: 0, correct: 0, wins: 0, losses: 0 });
    wasAboveThreshold.current = true;
    wasPositiveEnergy.current = true;
    setPhase("playing");
    sceneRef.current?.scene.restart();
  }

  const minutes = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const seconds = String(secondsLeft % 60).padStart(2, "0");
  const energyPct = Math.min(100, (energy / STARTING_ENERGY) * 100);

  return (
    <div className="flex h-full flex-col bg-[#7f7f7f]">
      <div className="flex flex-wrap items-center gap-3 border-b-2 border-[var(--color-ink)] bg-[var(--color-cream)] px-4 py-3 sm:gap-4 sm:px-5">
        <button
          type="button"
          onClick={onExit}
          aria-label="Exit game"
          className="rounded border-2 border-[var(--color-ink)] bg-white p-1.5 text-[var(--color-ink)] hover:bg-[var(--color-red-soft)]"
        >
          <XIcon />
        </button>
        <div className="flex min-w-[140px] flex-1 items-center gap-2">
          <ZapIcon className="h-4 w-4 shrink-0 text-[var(--color-orange)]" />
          <div className="h-4 w-full max-w-xs overflow-hidden rounded border-2 border-[var(--color-ink)] bg-white">
            <div
              className={`h-full transition-[width] duration-300 ${
                energy > 1000 ? "bg-[var(--color-green)]" : energy > 500 ? "bg-[var(--color-orange)]" : "bg-[var(--color-red)]"
              }`}
              style={{ width: `${energyPct}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-xs font-bold text-[var(--color-ink)]">{energy}</span>
        </div>
        <span className="font-mono text-xs font-bold text-[var(--color-ink)]">
          {stats.wins}W-{stats.losses}L
        </span>
        <span className="font-mono text-xs font-bold text-[var(--color-ink)]">
          {minutes}:{seconds}
        </span>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-auto py-4">
        <div className="w-fit border-2 border-[var(--color-ink)] shadow-[var(--shadow-brutal-md)]">
          <div ref={containerRef} />
        </div>

        {showLowEnergyToast && (
          <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-yellow)] px-4 py-2.5 font-mono text-sm font-bold text-[var(--color-ink)] shadow-[var(--shadow-brutal-md)]">
            ⚡ Low energy -- time to solve a question!
          </div>
        )}

        {roundBanner && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/20">
            <span
              className={`rounded-lg border-2 border-[var(--color-ink)] px-5 py-3 font-mono text-lg font-bold text-[var(--color-ink)] shadow-[var(--shadow-brutal-md)] ${
                roundBanner === "won" ? "bg-[var(--color-green-soft)]" : "bg-white"
              }`}
            >
              {roundBanner === "won" ? "VICTORY -- new duel starting!" : "DEFEATED -- new duel starting!"}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-[var(--color-ink)] bg-[var(--color-cream)] px-4 py-3 sm:px-5 sm:py-4">
        <p className="font-mono text-xs text-[var(--color-muted)]">ARROWS OR A/D TO MOVE · SPACE/W TO ATTACK</p>
        <button
          type="button"
          onClick={() => setPhase("mcq")}
          className={`inline-flex items-center gap-1.5 rounded-lg border-2 border-[var(--color-ink)] px-4 py-2.5 font-mono text-sm font-bold shadow-[var(--shadow-brutal-sm)] sm:px-5 sm:py-3 ${
            energy <= LOW_ENERGY_THRESHOLD ? "animate-pulse bg-[var(--color-yellow)] text-[var(--color-ink)]" : "bg-white text-[var(--color-ink)]"
          }`}
        >
          <ZapIcon className="h-4 w-4" />
          ANSWER QUESTIONS
        </button>
      </div>

      {phase === "mcq" && (
        <McqOverlay
          courseId={courseId}
          onAnswered={handleAnswered}
          onClose={handleMcqClose}
          forced={energy <= 0}
          onExitGame={onExit}
        />
      )}

      {phase === "session-end" && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-sm rounded-lg border-2 border-[var(--color-ink)] bg-white p-7 text-center shadow-[var(--shadow-brutal-lg)]">
            <p className="font-mono text-xs font-bold tracking-wide text-[var(--color-muted)]">SESSION COMPLETE</p>
            <p className="mt-2 font-serif text-3xl font-bold text-[var(--color-ink)]">
              {stats.wins}W - {stats.losses}L
            </p>
            <p className="mt-1 font-mono text-sm text-[var(--color-ink)]">
              {stats.correct}/{stats.answered} questions correct
            </p>
            <div className="mt-6 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={handlePlayAgain}
                className="rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-pink)] px-4 py-2.5 font-mono text-sm font-bold text-white shadow-[var(--shadow-brutal-sm)]"
              >
                PLAY AGAIN
              </button>
              <button
                type="button"
                onClick={onExit}
                className="rounded-lg border-2 border-[var(--color-ink)] bg-white px-4 py-2.5 font-mono text-sm font-bold text-[var(--color-ink)]"
              >
                EXIT
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
