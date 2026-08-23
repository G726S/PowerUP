import { useEffect, useRef, useState } from "react";
import { DropZone } from "./DropZone";
import { PdfIcon, XIcon, SpinnerIcon } from "./icons";
import { formatBytes } from "../lib/format";

interface CreateCourseModalProps {
  onClose: () => void;
  onSubmit: (name: string, files: File[]) => Promise<void>;
}

export function CreateCourseModal({ onClose, onSubmit }: CreateCourseModalProps) {
  const [name, setName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    nameInputRef.current?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(id);
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function addFiles(newFiles: File[]) {
    setFiles((prev) => {
      const existingKeys = new Set(prev.map((f) => `${f.name}-${f.size}`));
      const deduped = newFiles.filter((f) => !existingKeys.has(`${f.name}-${f.size}`));
      return [...prev, ...deduped];
    });
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  const canSubmit = name.trim().length > 0 && files.length > 0 && !isSubmitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(name.trim(), files);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-ink)]/40 px-4 transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-course-title"
        className={`w-full max-w-lg rounded-lg border-2 border-[var(--color-ink)] bg-white p-7 shadow-[var(--shadow-brutal-lg)] transition-all duration-200 ${
          visible ? "translate-y-0 opacity-100 scale-100" : "translate-y-2 opacity-0 scale-[0.98]"
        }`}
      >
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 id="create-course-title" className="font-serif text-xl font-bold text-[var(--color-ink)]">
              New course
            </h2>
            <p className="mt-0.5 font-mono text-sm text-[var(--color-muted)]">
              Give it a name and add the material you want to study.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded border-2 border-transparent p-1.5 text-[var(--color-ink)] hover:border-[var(--color-ink)] hover:bg-[var(--color-cream)]"
          >
            <XIcon />
          </button>
        </div>

        <label htmlFor="course-name" className="mb-1.5 block font-mono text-sm font-bold text-[var(--color-ink)]">
          COURSE NAME
        </label>
        <input
          id="course-name"
          ref={nameInputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. IFN580: Reinforcement Learning"
          className="mb-5 w-full rounded-lg border-2 border-[var(--color-ink)] bg-white px-3.5 py-2.5 font-mono text-sm text-[var(--color-ink)] placeholder:text-[var(--color-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-pink)]"
        />

        <span className="mb-1.5 block font-mono text-sm font-bold text-[var(--color-ink)]">MATERIALS</span>
        <DropZone onFilesSelected={addFiles} />

        {files.length > 0 && (
          <ul className="mt-3 max-h-40 space-y-1.5 overflow-y-auto">
            {files.map((file, i) => (
              <li
                key={`${file.name}-${file.size}-${i}`}
                className="flex items-center gap-2.5 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-cream)] px-3 py-2 font-mono text-sm"
              >
                <PdfIcon className="h-4 w-4 shrink-0 text-[var(--color-ink)]" />
                <span className="min-w-0 flex-1 truncate text-[var(--color-ink)]">{file.name}</span>
                <span className="shrink-0 text-xs text-[var(--color-muted)]">{formatBytes(file.size)}</span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  aria-label={`Remove ${file.name}`}
                  className="shrink-0 rounded p-0.5 text-[var(--color-ink)] hover:text-[var(--color-red)]"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p className="mt-3 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-red-soft)] px-3 py-2 font-mono text-sm text-[var(--color-ink)]">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border-2 border-transparent px-4 py-2.5 font-mono text-sm font-bold text-[var(--color-ink)] hover:border-[var(--color-ink)] hover:bg-[var(--color-cream)]"
          >
            CANCEL
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="inline-flex items-center gap-1.5 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-pink)] px-5 py-2.5 font-mono text-sm font-bold text-white shadow-[var(--shadow-brutal-sm)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[var(--shadow-brutal-md)] active:translate-x-0 active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-[var(--shadow-brutal-sm)]"
          >
            {isSubmitting && <SpinnerIcon className="h-3.5 w-3.5" />}
            {isSubmitting ? "CREATING…" : "CREATE COURSE"}
          </button>
        </div>
      </div>
    </div>
  );
}
