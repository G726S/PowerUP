import Phaser from "phaser";
import { useEffect, useRef, useState } from "react";
import * as api from "../api/client";
import { createSamuraiHorde, SamuraiHordeScene } from "../game/SamuraiHordeScene";
import { CORRECT_ANSWER_BONUS, DEFAULT_SESSION_SECONDS, LOW_ENERGY_THRESHOLD, STARTING_ENERGY } from "../lib/gameEconomy";
import { useSessionId } from "../session/SessionContext";
import { McqOverlay } from "./McqOverlay";
import { XIcon, ZapIcon } from "./icons";

interface SamuraiHordeGameProps {
  courseId: string;
  onExit: () => void;
  sessionSeconds?: number;
}

const ATTACK_COST = 80;
const MOVE_COST = 15;
// Up to 3 enemies can land a hit within the same ~1s window once they've
// all closed in -- at the old 180 this could burn through an entire MCQ
// refuel (+250) in one bad moment. Small enough now that a few hits is a
// real cost, not an instant re-drain back to zero.
const HIT_COST = 35;

type Phase = "playing" | "mcq" | "session-end";

/** Built from a teammate's pygame source -- multiple respawning enemies
 * swarm the player rather than a single 1v1 opponent, using the actual
 * character spritesheets from that source (see frontend/public/samurai-horde/
 * and SamuraiHordeScene.ts's preload()) -- same real art/animations, just
 * re-hosted for Phaser instead of pygame's sprite-sheet loader.
 *
 * No separate in-game health bar -- getting hit drains the SAME energy
 * meter that moving/attacking spends, so there's one bar, not two: taking
 * a beating just means you need to answer a question sooner to stay in
 * the fight, same "the meter IS the point of the game" rule as the other
 * two games, with combat now feeding directly into it instead of being a
 * separate win/lose track. */
export function SamuraiHordeGame({ courseId, onExit, sessionSeconds = DEFAULT_SESSION_SECONDS }: SamuraiHordeGameProps) {
  const sessionId = useSessionId();
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<SamuraiHordeScene | null>(null);

  const [energy, setEnergy] = useState(STARTING_ENERGY);
  const [kills, setKills] = useState(0);
  const [phase, setPhase] = useState<Phase>("playing");
  const [secondsLeft, setSecondsLeft] = useState(sessionSeconds);
  const [stats, setStats] = useState({ answered: 0, correct: 0 });
  const [showLowEnergyToast, setShowLowEnergyToast] = useState(false);
  const [showHitFlash, setShowHitFlash] = useState(false);
  const wasAboveThreshold = useRef(true);
  const wasPositiveEnergy = useRef(true);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    const game = createSamuraiHorde(containerRef.current);
    gameRef.current = game;

    function attach() {
      if (disposed) return;
      const scene = game.scene.getScene("SamuraiHorde") as SamuraiHordeScene;
      sceneRef.current = scene;
      scene.events.on("move-tick", () => setEnergy((e) => Math.max(0, e - MOVE_COST)));
      scene.events.on("attack", () => setEnergy((e) => Math.max(0, e - ATTACK_COST)));
      scene.events.on("kills", (total: number) => setKills(total));
      scene.events.on("hit", () => {
        setEnergy((e) => Math.max(0, e - HIT_COST));
        setShowHitFlash(true);
        setTimeout(() => setShowHitFlash(false), 250);
      });
    }
    game.events.once(Phaser.Core.Events.READY, attach);

    return () => {
      disposed = true;
      game.destroy(true);
      if (gameRef.current === game) gameRef.current = null;
      sceneRef.current = null;
    };
  }, []);

  // Running out of energy freezes the fight exactly where it is (scene
  // paused) and forces the MCQ open -- same rule as the other two games.
  // Getting hit drains this same meter, so a bad fight funnels straight
  // into "answer to survive" instead of a separate defeat state.
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
    if (phase === "mcq") game.scene.pause("SamuraiHorde");
    else if (phase === "playing") game.scene.resume("SamuraiHorde");
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
    setKills(0);
    setSecondsLeft(sessionSeconds);
    setStats({ answered: 0, correct: 0 });
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
        <span className="font-mono text-xs font-bold text-[var(--color-ink)]">KILLS {kills}</span>
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

        {showHitFlash && <div className="pointer-events-none absolute inset-0 z-10 bg-[var(--color-red)]/25" />}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-[var(--color-ink)] bg-[var(--color-cream)] px-4 py-3 sm:px-5 sm:py-4">
        <p className="font-mono text-xs text-[var(--color-muted)]">WASD OR ARROWS TO MOVE · SPACE TO ATTACK</p>
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
            <p className="mt-2 font-serif text-3xl font-bold text-[var(--color-ink)]">{kills} kills</p>
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
