import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { createMonkeyGame } from "../game/MonkeyClimbScene";

export function MonkeyGamePage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    gameRef.current = createMonkeyGame(containerRef.current);
    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 md:px-10 md:py-14">
      <header className="mb-6 flex flex-col gap-1">
        <h1 className="font-serif text-3xl font-bold text-[var(--color-ink)] md:text-4xl">Climb</h1>
        <p className="font-mono text-sm text-[var(--color-muted)]">
          A/D OR ARROWS TO MOVE · SPACE/UP/W TO JUMP · EAT BANANAS · DON'T FALL
        </p>
      </header>
      <div
        ref={containerRef}
        className="mx-auto w-fit overflow-hidden rounded-lg border-2 border-[var(--color-ink)] shadow-[var(--shadow-brutal-md)]"
      />
    </div>
  );
}
