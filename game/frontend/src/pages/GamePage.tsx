import { useMemo, useState } from "react";
import { usePoints } from "../hooks/usePoints";
import { CoinIcon, PlayIcon } from "../components/icons";

interface StatDef {
  key: "health" | "damage" | "speed";
  label: string;
  hint: string;
}

const STATS: StatDef[] = [
  { key: "health", label: "HEALTH", hint: "+5 max HP per point" },
  { key: "damage", label: "DAMAGE", hint: "+1 attack damage per point" },
  { key: "speed", label: "SPEED", hint: "+5 move speed per point" },
];

export function GamePage() {
  const { points, spend } = usePoints();
  const [allocation, setAllocation] = useState<Record<StatDef["key"], number>>({
    health: 0,
    damage: 0,
    speed: 0,
  });
  const [isLaunching, setIsLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spentSoFar = allocation.health + allocation.damage + allocation.speed;
  const remaining = points === null ? null : points - spentSoFar;

  const canAdd = remaining !== null && remaining > 0;

  function adjust(key: StatDef["key"], delta: number) {
    setAllocation((prev) => {
      const next = Math.max(0, prev[key] + delta);
      if (delta > 0 && !canAdd) return prev;
      return { ...prev, [key]: next };
    });
  }

  function resetAllocation() {
    setAllocation({ health: 0, damage: 0, speed: 0 });
  }

  const launchUrl = useMemo(() => {
    const params = new URLSearchParams({
      health: String(allocation.health),
      damage: String(allocation.damage),
      speed: String(allocation.speed),
    });
    return `/play/?${params.toString()}`;
  }, [allocation]);

  async function handleLaunch() {
    if (spentSoFar === 0) {
      window.open("/play/", "_blank", "noopener");
      return;
    }
    setError(null);
    setIsLaunching(true);
    try {
      const ok = await spend(spentSoFar);
      if (!ok) {
        setError("Couldn't spend those points -- your balance may have changed.");
        return;
      }
      window.open(launchUrl, "_blank", "noopener");
      resetAllocation();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't launch the game.");
    } finally {
      setIsLaunching(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 md:px-10 md:py-14">
      <header className="mb-8 flex flex-col gap-1">
        <h1 className="font-serif text-3xl font-bold text-[var(--color-ink)] md:text-4xl">Power up</h1>
        <p className="font-mono text-sm text-[var(--color-muted)]">
          SPEND POINTS FROM QUIZZES ON YOUR FIGHTER BEFORE YOU PLAY.
        </p>
      </header>

      <div className="mb-6 flex items-center justify-between rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-cream)] px-5 py-4">
        <span className="font-mono text-xs font-bold tracking-wide text-[var(--color-muted)]">BALANCE</span>
        <span className="flex items-center gap-1.5 font-mono text-lg font-bold text-[var(--color-ink)]">
          <CoinIcon className="h-5 w-5 text-[var(--color-orange)]" />
          {remaining ?? "…"}
        </span>
      </div>

      {points === 0 && (
        <p className="mb-6 rounded-lg border-2 border-dashed border-[var(--color-ink)] px-5 py-4 text-center font-mono text-sm text-[var(--color-muted)]">
          You don't have any points yet. Answer quiz questions correctly to earn some.
        </p>
      )}

      <div className="mb-6 grid gap-3">
        {STATS.map((stat) => (
          <div
            key={stat.key}
            className="flex items-center justify-between rounded-lg border-2 border-[var(--color-ink)] bg-white px-5 py-4"
          >
            <div>
              <p className="font-mono text-sm font-bold text-[var(--color-ink)]">{stat.label}</p>
              <p className="font-mono text-xs text-[var(--color-muted)]">{stat.hint}</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => adjust(stat.key, -1)}
                disabled={allocation[stat.key] === 0}
                aria-label={`Decrease ${stat.label}`}
                className="flex h-8 w-8 items-center justify-center rounded-lg border-2 border-[var(--color-ink)] font-mono font-bold text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-30"
              >
                −
              </button>
              <span className="w-8 text-center font-mono text-base font-bold text-[var(--color-ink)]">
                {allocation[stat.key]}
              </span>
              <button
                type="button"
                onClick={() => adjust(stat.key, 1)}
                disabled={!canAdd}
                aria-label={`Increase ${stat.label}`}
                className="flex h-8 w-8 items-center justify-center rounded-lg border-2 border-[var(--color-ink)] font-mono font-bold text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-30"
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-6 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-red-soft)] px-4 py-3 font-mono text-sm text-[var(--color-ink)]">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={resetAllocation}
          disabled={spentSoFar === 0}
          className="rounded-lg border-2 border-[var(--color-ink)] bg-white px-5 py-2.5 font-mono text-sm font-bold text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          RESET
        </button>
        <button
          type="button"
          onClick={handleLaunch}
          disabled={isLaunching}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-pink)] px-5 py-2.5 font-mono text-sm font-bold text-white shadow-[var(--shadow-brutal-sm)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[var(--shadow-brutal-md)] active:translate-x-0 active:translate-y-0 active:shadow-none disabled:opacity-60"
        >
          <PlayIcon className="h-3.5 w-3.5" />
          {spentSoFar === 0 ? "LAUNCH GAME" : `LAUNCH WITH ${spentSoFar} POINTS SPENT`}
        </button>
      </div>
    </div>
  );
}
