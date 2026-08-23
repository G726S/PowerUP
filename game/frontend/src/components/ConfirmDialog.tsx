import { useEffect, useState } from "react";
import { SpinnerIcon } from "./icons";

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel?: string;
  isDangerous?: boolean;
  isBusy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = "Delete",
  isDangerous = true,
  isBusy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-ink)]/40 px-4 transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className={`w-full max-w-sm rounded-lg border-2 border-[var(--color-ink)] bg-white p-6 shadow-[var(--shadow-brutal-lg)] transition-all duration-200 ${
          visible ? "translate-y-0 opacity-100 scale-100" : "translate-y-2 opacity-0 scale-[0.98]"
        }`}
      >
        <h2 id="confirm-title" className="font-serif text-lg font-bold text-[var(--color-ink)]">
          {title}
        </h2>
        <p className="mt-1.5 font-mono text-sm text-[var(--color-muted)]">{description}</p>
        <div className="mt-5 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border-2 border-transparent px-4 py-2.5 font-mono text-sm font-bold text-[var(--color-ink)] hover:border-[var(--color-ink)] hover:bg-[var(--color-cream)]"
          >
            CANCEL
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isBusy}
            className={`inline-flex items-center gap-1.5 rounded-lg border-2 border-[var(--color-ink)] px-5 py-2.5 font-mono text-sm font-bold text-white shadow-[var(--shadow-brutal-sm)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[var(--shadow-brutal-md)] active:translate-x-0 active:translate-y-0 active:shadow-none disabled:opacity-50 ${
              isDangerous ? "bg-[var(--color-red)]" : "bg-[var(--color-pink)]"
            }`}
          >
            {isBusy && <SpinnerIcon className="h-3.5 w-3.5" />}
            {confirmLabel.toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );
}
