import { Link } from "react-router-dom";
import { usePoints } from "../hooks/usePoints";
import { BookIcon, CoinIcon, PlayIcon } from "./icons";

export function AppHeader() {
  const { points } = usePoints();

  return (
    <header className="border-b-2 border-[var(--color-ink)] bg-[var(--color-yellow)]">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-4 md:px-10">
        <Link to="/" className="flex items-center gap-2 font-mono text-lg font-bold tracking-tight text-[var(--color-ink)]">
          <BookIcon className="h-5 w-5" />
          POWERUP
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1.5 rounded-lg border-2 border-[var(--color-ink)] bg-white px-3 py-1.5 font-mono text-sm font-bold text-[var(--color-ink)]">
            <CoinIcon className="h-4 w-4 text-[var(--color-orange)]" />
            {points ?? "…"}
          </span>
          <Link
            to="/game"
            className="inline-flex items-center gap-1.5 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-pink)] px-3 py-1.5 font-mono text-sm font-bold text-white shadow-[var(--shadow-brutal-sm)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[var(--shadow-brutal-md)] active:translate-x-0 active:translate-y-0 active:shadow-none"
          >
            <PlayIcon className="h-3.5 w-3.5" />
            SAMURAI
          </Link>
          <Link
            to="/climb"
            className="inline-flex items-center gap-1.5 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-green)] px-3 py-1.5 font-mono text-sm font-bold text-white shadow-[var(--shadow-brutal-sm)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[var(--shadow-brutal-md)] active:translate-x-0 active:translate-y-0 active:shadow-none"
          >
            <PlayIcon className="h-3.5 w-3.5" />
            CLIMB
          </Link>
        </div>
      </div>
    </header>
  );
}
