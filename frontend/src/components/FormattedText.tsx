import type { ReactNode } from "react";

interface FormattedTextProps {
  text: string;
  className?: string;
}

/** Renders exactly the subset of Markdown the backend prompts are told to
 * use (see gemini_client.LIGHT_MARKDOWN_RULE): **bold** spans and "- "
 * bullet lines. No external Markdown library -- the supported syntax is
 * deliberately tiny, so a ~40-line parser covers it exactly. */
export function FormattedText({ text, className = "" }: FormattedTextProps) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let currentList: string[] = [];
  let listKey = 0;

  function flushList() {
    if (currentList.length === 0) return;
    const key = `list-${listKey++}`;
    blocks.push(
      <ul key={key} className="my-2 space-y-1.5 first:mt-0 last:mb-0">
        {currentList.map((item, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-pink)]" />
            <span>{renderInline(item, `${key}-${i}`)}</span>
          </li>
        ))}
      </ul>,
    );
    currentList = [];
  }

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    const bulletMatch = trimmed.match(/^[-*]\s+(.*)/);
    if (bulletMatch) {
      currentList.push(bulletMatch[1]);
      return;
    }
    flushList();
    if (trimmed) {
      blocks.push(
        <p key={`p-${i}`} className="mb-2 leading-relaxed first:mt-0 last:mb-0">
          {renderInline(trimmed, `p-${i}`)}
        </p>,
      );
    }
  });
  flushList();

  return <div className={className}>{blocks}</div>;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts
    .filter((part) => part.length > 0)
    .map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        return (
          <strong key={`${keyPrefix}-${i}`} className="font-bold text-[var(--color-ink)]">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return <span key={`${keyPrefix}-${i}`}>{part}</span>;
    });
}
