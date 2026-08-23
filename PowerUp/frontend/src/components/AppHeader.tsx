import { Link } from "react-router-dom";
import { BookIcon } from "./icons";

export function AppHeader() {
  return (
    <header className="border-b-2 border-[var(--color-ink)] bg-[var(--color-yellow)]">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-6 py-4 md:px-10">
        <Link to="/" className="flex items-center gap-2 font-mono text-lg font-bold tracking-tight text-[var(--color-ink)]">
          <BookIcon className="h-5 w-5" />
          POWERUP
        </Link>
      </div>
    </header>
  );
}
