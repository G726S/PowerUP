import { useRef, useState } from "react";
import { UploadCloudIcon } from "./icons";

interface DropZoneProps {
  onFilesSelected: (files: File[]) => void;
  compact?: boolean;
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function DropZone({ onFilesSelected, compact = false }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(fileList: FileList | null) {
    if (!fileList) return;
    const files = Array.from(fileList).filter(isPdf);
    if (files.length > 0) onFilesSelected(files);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-center transition-colors duration-150 ${
        compact ? "px-4 py-6" : "px-6 py-10"
      } ${
        isDragging
          ? "border-[var(--color-ink)] bg-[var(--color-yellow)]"
          : "border-[var(--color-ink)] bg-[var(--color-cream)] hover:bg-[var(--color-yellow)]/40"
      }`}
    >
      <UploadCloudIcon className={`${compact ? "h-6 w-6" : "h-8 w-8"} text-[var(--color-ink)]`} />
      <p className="font-mono text-sm font-bold text-[var(--color-ink)]">
        Drag and drop PDFs here, or <span className="text-[var(--color-pink-dark)] underline">browse</span>
      </p>
      {!compact && <p className="font-mono text-xs text-[var(--color-muted)]">PDF FILES ONLY</p>}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
