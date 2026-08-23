"""
PDF -> Multiple-choice question generator agent (Google Gemini API, free tier).

Two-stage pipeline:

1. Distill (once per PDF, cached to disk) -- Gemini reads the raw PDF
   (text, tables, and diagrams -- full multimodal reading, not OCR) and
   produces a clean technical study context in plain text, deliberately
   excluding course administration (due dates, marks, submission logistics).
2. Generate (every call) -- a batch of multiple-choice questions is
   generated from that cached text context, not the PDF, so repeat/top-up
   calls are fast and never re-touch the original file. Each call is told
   which questions were already generated (from the local question bank)
   so top-ups don't repeat earlier ones.

Every generated question is appended to a local per-PDF "bank" (JSON) that
doubles as both the served question pool and the de-duplication history.

Setup:
    pip install google-genai pydantic
    Get a free API key at https://aistudio.google.com/apikey
    export GEMINI_API_KEY=...   # never hardcode the key

Usage:
    python pdf_qa_agent.py path/to/notes.pdf -n 30          # first batch
    python pdf_qa_agent.py path/to/notes.pdf -n 15          # top-up later, avoids repeats
    python pdf_qa_agent.py path/to/notes.pdf -n 10 --reset  # wipe cache, start over

------------------------------------------------------------------------------
BACKEND INTEGRATION NOTE -- read before renaming/restructuring anything below
------------------------------------------------------------------------------
This file is imported directly (not just run as a CLI) by the FastAPI backend
at backend/app/pdf_pipeline.py, which does `import pdf_qa_agent` and calls:

    get_client()                                     -- shared Gemini client factory
    cache_paths(pdf_path, cache_dir)                  -- resolve this PDF's cache file paths
    get_or_create_context(client, pdf_path, model,
                           context_path, force=False)  -- distill + cache a study context
    generate_mcq_batch_safe(client, context_text,
                             num_questions, model,
                             exclude_questions)         -- generate MCQs w/ retry, grounded in text

`get_client()` and `require_api_key()` were added specifically for this --
they didn't exist in the original CLI-only version. If this file gets
replaced with an updated version, either keep those functions (and the
signatures above) intact, or update backend/app/pdf_pipeline.py to match --
otherwise course ingestion/chapters/flashcards/quiz generation will break.
------------------------------------------------------------------------------
"""

import argparse
import hashlib
import json
import os
import sys

from google import genai
from google.genai import types
from pydantic import BaseModel

# Gemini's inline-request limit is ~20MB; larger files go through the Files API instead.
INLINE_SIZE_LIMIT = 19 * 1024 * 1024

DEFAULT_CACHE_DIR = ".pdf_qa_cache"

ADMIN_EXCLUSION_RULE = (
    "Do NOT include course administration -- skip anything about assignment due "
    "dates, marks or weighting, submission requirements, semester schedule, or "
    "grading. If the material is purely administrative, leave it out entirely."
)


class MCQItem(BaseModel):
    question: str
    options: list[str]
    correct_index: int
    explanation: str


def require_api_key() -> None:
    """Raise if no Gemini API key is configured. Callable from a CLI or a server
    startup path alike -- unlike sys.exit, this doesn't kill the whole process."""
    if not (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")):
        raise RuntimeError(
            "Set the GEMINI_API_KEY environment variable before running "
            "(get a free key at https://aistudio.google.com/apikey)."
        )


def get_client() -> genai.Client:
    """Shared client factory -- both the CLI entrypoint and the FastAPI backend
    call this instead of constructing genai.Client() themselves."""
    require_api_key()
    return genai.Client()


def pdf_cache_key(pdf_path: str) -> str:
    with open(pdf_path, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()[:8]
    base = os.path.splitext(os.path.basename(pdf_path))[0]
    return f"{base}_{digest}"


def cache_paths(pdf_path: str, cache_dir: str) -> tuple[str, str]:
    key = pdf_cache_key(pdf_path)
    return (
        os.path.join(cache_dir, f"{key}_context.txt"),
        os.path.join(cache_dir, f"{key}_bank.json"),
    )


def load_pdf_part(client: genai.Client, pdf_path: str):
    with open(pdf_path, "rb") as f:
        data = f.read()
    if not data:
        raise ValueError(f"'{pdf_path}' is empty.")
    if len(data) <= INLINE_SIZE_LIMIT:
        return types.Part.from_bytes(data=data, mime_type="application/pdf")
    return client.files.upload(file=pdf_path)  # large PDFs: upload instead of inlining


def distill_context(client: genai.Client, pdf_path: str, model: str) -> str:
    """One-time, expensive call: read the raw PDF and produce a clean technical
    study context in plain text. This is the only step that ever touches the PDF."""
    pdf_part = load_pdf_part(client, pdf_path)
    prompt = (
        "Produce a clean, structured technical study context from this PDF, "
        "organized by topic. Capture every technical concept, definition, formula, "
        "comparison, diagram, and example -- including facts that live only in "
        "diagrams/images, not just body text. Write out diagram content in words "
        "(e.g. describe what a diagram compares or shows). "
        + ADMIN_EXCLUSION_RULE
        + " Output plain text, organized with headings."
    )
    response = client.models.generate_content(model=model, contents=[pdf_part, prompt])
    return response.text


def get_or_create_context(client: genai.Client, pdf_path: str, model: str, context_path: str, force: bool = False) -> str:
    if not force and os.path.exists(context_path):
        with open(context_path, "r", encoding="utf-8") as f:
            return f.read()
    context_text = distill_context(client, pdf_path, model)
    os.makedirs(os.path.dirname(context_path), exist_ok=True)
    with open(context_path, "w", encoding="utf-8") as f:
        f.write(context_text)
    return context_text


def load_bank(bank_path: str) -> list[dict]:
    if not os.path.exists(bank_path):
        return []
    with open(bank_path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_bank(bank_path: str, items: list[dict]) -> None:
    os.makedirs(os.path.dirname(bank_path), exist_ok=True)
    with open(bank_path, "w", encoding="utf-8") as f:
        json.dump(items, f, indent=2)


def build_generation_prompt(context_text: str, num_questions: int, exclude_questions: list[str]) -> str:
    parts = [
        f"Generate exactly {num_questions} multiple-choice questions, strictly grounded "
        "in the study context below -- do not introduce facts not present in it.",
        "Focus only on technical and conceptual learning content: definitions, "
        "algorithms, formulas, comparisons between techniques, workflows, and "
        "trade-offs. " + ADMIN_EXCLUSION_RULE,
        "Spread the questions across different topics rather than clustering them "
        "on one part.",
    ]
    if exclude_questions:
        already_asked = "\n".join(f"- {q}" for q in exclude_questions)
        parts.append(
            "The following questions have already been asked -- do NOT repeat them "
            "or ask close rephrasings of them:\n" + already_asked
        )
    parts.append(
        "For each question, provide exactly 4 answer options with exactly one "
        "correct answer (give correct_index as the 0-based index of the correct "
        "option), and a 1-2 sentence explanation of why that answer is correct."
    )
    parts.append("--- Study context ---\n" + context_text)
    return "\n\n".join(parts)


def validate_mcq_items(items: list[dict]) -> list[dict]:
    out = []
    for item in items:
        if not str(item.get("question", "")).strip() or not str(item.get("explanation", "")).strip():
            continue
        options = item.get("options")
        if not isinstance(options, list) or len(options) != 4 or not all(str(o).strip() for o in options):
            continue
        idx = item.get("correct_index")
        if not isinstance(idx, int) or not (0 <= idx <= 3):
            continue
        out.append(item)
    return out


def generate_mcq_batch(client: genai.Client, context_text: str, num_questions: int, model: str, exclude_questions: list[str]) -> list[dict]:
    prompt = build_generation_prompt(context_text, num_questions, exclude_questions)
    response = client.models.generate_content(
        model=model,
        contents=[prompt],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=list[MCQItem],
        ),
    )
    if response.parsed is not None:
        items = [item.model_dump() for item in response.parsed]
    else:
        items = json.loads(response.text)  # fallback if .parsed wasn't populated
    return validate_mcq_items(items)


def generate_mcq_batch_safe(client: genai.Client, context_text: str, num_questions: int, model: str, exclude_questions: list[str], retries: int = 2) -> list[dict]:
    last_error = None
    for _ in range(retries):
        try:
            items = generate_mcq_batch(client, context_text, num_questions, model, exclude_questions)
            if items:
                return items[:num_questions]
        except Exception as e:  # noqa: BLE001 -- surfaced to the caller below
            last_error = e
    raise RuntimeError(f"Failed to generate MCQ items after {retries} attempts") from last_error


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate multiple-choice questions from a PDF using Gemini (free tier).")
    parser.add_argument("pdf_path", help="Path to the PDF file")
    parser.add_argument("-n", "--num-questions", type=int, default=10, help="Number of NEW MCQs to generate this run (default: 10)")
    parser.add_argument("--model", default="gemini-3.6-flash", help="Gemini model to use (default: gemini-3.6-flash, free tier).")
    parser.add_argument("--cache-dir", default=DEFAULT_CACHE_DIR, help=f"Where to store the distilled context + question bank (default: {DEFAULT_CACHE_DIR})")
    parser.add_argument("--regenerate-context", action="store_true", help="Force re-distilling the PDF even if a cached context exists")
    parser.add_argument("--reset", action="store_true", help="Wipe this PDF's cached context and question bank before running")
    parser.add_argument("-o", "--output", help="Optional path to also write this run's NEW MCQs as JSON")
    args = parser.parse_args()

    try:
        require_api_key()
    except RuntimeError as e:
        sys.exit(str(e))

    context_path, bank_path = cache_paths(args.pdf_path, args.cache_dir)

    if args.reset:
        for path in (context_path, bank_path):
            if os.path.exists(path):
                os.remove(path)
        print("Cache cleared for this PDF.")

    client = get_client()

    context_existed = os.path.exists(context_path) and not args.regenerate_context
    context_text = get_or_create_context(client, args.pdf_path, args.model, context_path, force=args.regenerate_context)
    print(f"{'Loaded cached' if context_existed else 'Distilled fresh'} study context ({len(context_text)} chars) -> {context_path}")

    bank = load_bank(bank_path)
    exclude_questions = [item["question"] for item in bank]
    if exclude_questions:
        print(f"Bank already has {len(exclude_questions)} question(s) for this PDF -- generating new ones that avoid repeats.")

    new_items = generate_mcq_batch_safe(client, context_text, args.num_questions, args.model, exclude_questions)

    bank.extend(new_items)
    save_bank(bank_path, bank)

    for i, item in enumerate(new_items, 1):
        print(f"\nQ{i}: {item['question']}")
        for j, option in enumerate(item["options"]):
            marker = "*" if j == item["correct_index"] else " "
            print(f"  [{marker}] {chr(65 + j)}. {option}")
        print(f"Explanation: {item['explanation']}")

    print(f"\nGenerated {len(new_items)} new question(s). Bank now has {len(bank)} total for this PDF -> {bank_path}")

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(new_items, f, indent=2)
        print(f"Saved this run's new questions to {args.output}")


if __name__ == "__main__":
    main()
