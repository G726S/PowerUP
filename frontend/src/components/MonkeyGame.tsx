import Phaser from "phaser";
import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../api/client";
import { createMonkeyGame, MonkeyClimbScene } from "../game/MonkeyClimbScene";
import { CORRECT_ANSWER_BONUS, DEFAULT_SESSION_SECONDS, LOW_ENERGY_THRESHOLD, STARTING_ENERGY } from "../lib/gameEconomy";
import { useSessionId } from "../session/SessionContext";
import { McqOverlay } from "./McqOverlay";
import { XIcon, ZapIcon } from "./icons";

interface MonkeyGameProps {
  courseId: string;
  onExit: () => void;
  sessionSeconds?: number;
}

const JUMP_COST = 110;
const MOVE_COST = 20;
const BANANA_BONUS = 50;
const FALL_FLASH_MS = 1400;

type Phase = "playing" | "mcq" | "session-end";

/** Real gravity/jump-arc physics via Phaser (see game/MonkeyClimbScene.ts)
 * instead of a discrete DOM grid -- the scene owns movement/platforms/
 * camera/bananas and reports jump/move/banana/gameover events on its own
 * emitter; this component owns the study-app economy (energy, session
 * timer, MCQ refuel) and reacts to those events, matching the same pattern
 * SamuraiGame uses to bolt the economy onto a game engine it doesn't own
 * the internals of. */
export function MonkeyGame({ courseId, onExit, sessionSeconds = DEFAULT_SESSION_SECONDS }: MonkeyGameProps) {
  const sessionId = useSessionId();
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<MonkeyClimbScene | null>(null);

  const [energy, setEnergy] = useState(STARTING_ENERGY);
  const [height, setHeight] = useState(0);
  const [bananas, setBananas] = useState(0);
  const [phase, setPhase] = useState<Phase>("playing");
  const [secondsLeft, setSecondsLeft] = useState(sessionSeconds);
  const [stats, setStats] = useState({ answered: 0, correct: 0, falls: 0, bestHeight: 0 });
  const [showLowEnergyToast, setShowLowEnergyToast] = useState(false);
  const [justFell, setJustFell] = useState(false);
  const wasAboveThreshold = useRef(true);
  const wasPositiveEnergy = useRef(true);
  const phaseRef = useRef<Phase>("playing");
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const handleFall = useCallback((finalHeight: number) => {
    setJustFell(true);
    setTimeout(() => setJustFell(false), FALL_FLASH_MS);
    setStats((s) => ({ ...s, falls: s.falls + 1, bestHeight: Math.max(s.bestHeight, finalHeight) }));
    setEnergy(STARTING_ENERGY);
    setHeight(0);
    setBananas(0);
    wasPositiveEnergy.current = true;
    // Let the "YOU FELL" flash actually be seen before respawning, same
    // pacing the old DOM version used. Only restarts if still in normal
    // play -- if an MCQ opened in the meantime (forced or voluntary) this
    // must NOT yank the scene out from under it.
    setTimeout(() => {
      if (phaseRef.current === "playing") sceneRef.current?.scene.restart();
    }, FALL_FLASH_MS);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    // React StrictMode (dev only) runs this effect, its cleanup, then this
    // effect again -- Phaser's own boot is async, so without this guard a
    // first instance's still-pending "ready" callback can fire (and attach
    // its own listeners) AFTER its cleanup already ran, leaving two live
    // listener sets briefly double-charging energy on every action.
    let disposed = false;
    const game = createMonkeyGame(containerRef.current);
    gameRef.current = game;

    function attach() {
      if (disposed) return;
      const scene = game.scene.getScene("MonkeyClimb") as MonkeyClimbScene;
      sceneRef.current = scene;
      scene.events.on("jump", () => setEnergy((e) => Math.max(0, e - JUMP_COST)));
      scene.events.on("move-tick", () => setEnergy((e) => Math.max(0, e - MOVE_COST)));
      scene.events.on("banana", (count: number) => {
        setEnergy((e) => e + BANANA_BONUS);
        setBananas(count);
      });
      scene.events.on("height", (h: number) => setHeight(h));
      scene.events.on("gameover", (stats: { height: number; bananas: number }) => handleFall(stats.height));
    }
    game.events.once(Phaser.Core.Events.READY, attach);

    return () => {
      disposed = true;
      game.destroy(true);
      if (gameRef.current === game) gameRef.current = null;
      sceneRef.current = null;
    };
  }, [handleFall]);

  // Running out of energy is NOT a fall -- that's the whole point of the
  // meter: it freezes the climb exactly where you are (scene paused, same
  // as an MCQ opening voluntarily) and forces the MCQ open, rather than
  // resetting your progress. You keep your height; you just can't move
  // again until you've refueled.
  useEffect(() => {
    const wasPositive = wasPositiveEnergy.current;
    if (wasPositive && energy <= 0 && phase === "playing") {
      setPhase("mcq");
    }
    wasPositiveEnergy.current = energy > 0;
  }, [energy, phase]);

  // Pausing the Phaser scene while the MCQ overlay is open freezes gravity
  // too, so the player can't fall mid-question -- the OUTER session timer
  // (below) is a separate clock and keeps running regardless.
  useEffect(() => {
    const game = gameRef.current;
    if (!game) return;
    if (phase === "mcq") game.scene.pause("MonkeyClimb");
    else if (phase === "playing") game.scene.resume("MonkeyClimb");
  }, [phase]);

  // Closing the MCQ while energy is STILL at zero can't actually resume
  // play -- there'd be nothing to do but immediately re-trigger this same
  // gate. Keep the overlay open (it stays mounted, so "another question" is
  // still right there) until a correct answer actually refuels above zero.
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
    setHeight(0);
    setBananas(0);
    setSecondsLeft(sessionSeconds);
    setStats({ answered: 0, correct: 0, falls: 0, bestHeight: 0 });
    wasAboveThreshold.current = true;
    wasPositiveEnergy.current = true;
    setPhase("playing");
    sceneRef.current?.scene.restart();
  }

  const minutes = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const seconds = String(secondsLeft % 60).padStart(2, "0");
  const energyPct = Math.min(100, (energy / STARTING_ENERGY) * 100);

  return (
    <div className="flex h-full flex-col bg-[#7ec8e3]">
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
        <span className="rounded border-2 border-[var(--color-ink)] bg-[var(--color-yellow)] px-2 py-1 font-mono text-xs font-bold text-[var(--color-ink)]">
          HEIGHT {height}
        </span>
        <span className="font-mono text-xs font-bold text-[var(--color-ink)]">
          BEST {Math.max(stats.bestHeight, height)}
        </span>
        <span className="font-mono text-xs font-bold text-[var(--color-ink)]">🍌 {bananas}</span>
        <span className="font-mono text-xs font-bold text-[var(--color-ink)]">
          {minutes}:{seconds}
        </span>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-auto py-4">
        {/* No rounded corners here -- a border-radius on the wrapper clipped
            the canvas's own top-left HUD badge that sat right at the
            corner. A square frame with just a border/shadow avoids that
            entirely while still matching the app's card styling. */}
        <div ref={containerRef} className="w-fit border-2 border-[var(--color-ink)] shadow-[var(--shadow-brutal-md)]" />

        {showLowEnergyToast && (
          <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-yellow)] px-4 py-2.5 font-mono text-sm font-bold text-[var(--color-ink)] shadow-[var(--shadow-brutal-md)]">
            ⚡ Low energy -- time to solve a question!
          </div>
        )}

        {justFell && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[var(--color-red)]/30">
            <span className="rounded-lg border-2 border-[var(--color-ink)] bg-white px-5 py-3 font-mono text-lg font-bold text-[var(--color-ink)] shadow-[var(--shadow-brutal-md)]">
              YOU FELL -- back to the start!
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-[var(--color-ink)] bg-[var(--color-cream)] px-4 py-3 sm:px-5 sm:py-4">
        <p className="font-mono text-xs text-[var(--color-muted)]">ARROWS OR WASD TO MOVE · UP/SPACE TO JUMP</p>
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
            <p className="mt-2 font-serif text-3xl font-bold text-[var(--color-ink)]">Height {stats.bestHeight}</p>
            <p className="mt-1 font-mono text-sm text-[var(--color-ink)]">
              {stats.correct}/{stats.answered} questions correct · fell {stats.falls} {stats.falls === 1 ? "time" : "times"}
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
