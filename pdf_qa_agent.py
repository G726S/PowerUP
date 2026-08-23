"""
PDF -> MCQ generator using Google Gemini (free tier / Google AI Studio key).

Reads a PDF, extracts its text, and asks Gemini to generate multiple-choice
questions grounded strictly in that text -- one small batch of questions per
chunk, looped over every chunk in the document, so the output covers the
whole PDF instead of a sampled subset. Each question is saved with its
explanation so a consuming app (e.g. a game) can show why a wrong answer
was wrong.

Setup:
    pip install fastapi uvicorn python-multipart pypdf google-genai
    export GOOGLE_API_KEY=...   # or GEMINI_API_KEY

Usage:
    python pdf_qa_agent.py path/to/notes.pdf
    python pdf_qa_agent.py path/to/notes.pdf --questions-per-chunk 3 -o mcqs.json
    python pdf_qa_agent.py path/to/notes.pdf -n 20            # cap total questions kept
    python pdf_qa_agent.py path/to/notes.pdf --chunk-size 800 # more, smaller chunks -> more questions
    python pdf_qa_agent.py path/to/notes.pdf --concurrency 8  # faster generation
"""

import argparse
import concurrent.futures
import json
import os
import re
import sys

from google import genai
from dotenv import load_dotenv
from pypdf import PdfReader

load_dotenv()


def extract_text(pdf_path: str) -> str:
    reader = PdfReader(pdf_path)
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    if not text.strip():
        raise ValueError(
            f"No extractable text in '{pdf_path}'. This usually means it's a "
            "scanned/image-based PDF (OCR is not supported here) -- try a "
            "text-based PDF instead."
        )
    return text


def chunk_text(raw_text: str, target_size: int = 1200, max_chunks: int = 60) -> list[str]:
    """Split into ~target_size chunks so long PDFs don't blow past a
    reasonable single-request size, and so every chunk gets its own
    generation call instead of a few chunks dominating the document.

    Splits on blank lines first, but PDF text extraction (especially from
    slide decks) often has few or no blank lines, which would otherwise
    leave a single huge "paragraph" as one lopsided chunk -- so any
    paragraph still over target_size is hard-split on top of that.
    """
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", raw_text) if p.strip()]

    pieces = []
    for para in paragraphs:
        if len(para) <= target_size:
            pieces.append(para)
        else:
            for i in range(0, len(para), target_size):
                piece = para[i : i + target_size].strip()
                if piece:
                    pieces.append(piece)

    chunks, buf = [], ""
    for piece in pieces:
        if len(buf) + len(piece) > target_size and buf:
            chunks.append(buf)
            buf = piece
        else:
            buf = (buf + "\n" + piece).strip() if buf else piece
    if buf:
        chunks.append(buf)
    return chunks[:max_chunks]


def build_prompt(selected_chunks: list[str], num_questions: int) -> str:
    material = "\n\n".join(f"--- Excerpt {i + 1} ---\n{c}" for i, c in enumerate(selected_chunks))
    return (
        f"Generate up to {num_questions} multiple-choice questions that test understanding of the SUBJECT-MATTER "
        "content in the text below (concepts, definitions, methods, processes, comparisons, cause-and-effect, "
        "examples, and how ideas apply). Use a mix of question styles -- recall, concept application, comparison, "
        "and scenario-based reasoning -- and avoid shallow or trivial questions.\n\n"
        "Do NOT create questions about course administration or logistics: instructor/coordinator names, "
        "emails, contact links, teaching-team roles, room numbers, week/date schedules, CRICOS codes, or similar "
        "housekeeping details, even if they appear in the text. If an excerpt is purely administrative "
        "(e.g. a title slide or contact-details slide) with no real subject-matter content, generate fewer "
        "questions from it rather than inventing an administrative question -- an empty result for that "
        "excerpt is fine.\n\n"
        "Do not introduce facts not present in the material. "
        "Each question must have exactly 4 options labeled A, B, C, D, exactly one correct answer, and a short explanation. "
        "Return valid JSON only in this exact shape (an empty array [] is a valid response): "
        "[{\"question\": \"...\", \"options\": [\"...\", \"...\", \"...\", \"...\"], \"correct_answer\": \"B\", \"explanation\": \"...\"}]\n\n"
        + material
    )


def parse_mcqs(raw_text: str) -> list[dict]:
    text = raw_text.strip()

    if text.startswith("```"):
        match = re.search(r"```(?:json)?\s*(\[.*\])\s*```", text, flags=re.S | re.I)
        if match:
            text = match.group(1)

    data = json.loads(text)
    if isinstance(data, dict):
        data = data.get("mcqs", data.get("questions", []))
    if not isinstance(data, list):
        raise ValueError("Model response was not a JSON list of MCQs.")

    valid = []
    for item in data:
        q = str(item.get("question", "")).strip()
        options = item.get("options") or []
        correct = str(item.get("correct_answer", "")).strip()
        explanation = str(item.get("explanation", "")).strip()

        if not q or len(options) != 4 or not correct or not explanation:
            continue
        valid.append(
            {
                "question": q,
                "options": [str(opt).strip() for opt in options[:4]],
                "correct_answer": correct.upper(),
                "explanation": explanation,
            }
        )

    return valid


def configure_client() -> genai.Client:
    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        sys.exit(
            "Set the GOOGLE_API_KEY environment variable before running.\n"
            "Example: export GOOGLE_API_KEY=\"your-key-here\""
        )

    return genai.Client(api_key=api_key)


def generate_mcqs(client: genai.Client, model_name: str, chunks: list[str], num_questions: int) -> list[dict]:
    prompt = build_prompt(chunks, num_questions)
    response = client.models.generate_content(model=model_name, contents=prompt)
    return parse_mcqs(response.text)


def generate_mcqs_safe(
    client: genai.Client, model_name: str, chunks: list[str], num_questions: int, retries: int = 2
) -> list[dict]:
    """An empty list is a valid, successful result (the chunk had no real
    subject-matter content worth a question) and is returned immediately
    rather than retried. Only exceptions (API errors, bad JSON) are retried."""
    last_error = None
    for _ in range(retries):
        try:
            mcqs = generate_mcqs(client, model_name, chunks, num_questions)
            return mcqs[:num_questions]
        except Exception as e:  # noqa: BLE001 -- surfaced to caller below
            last_error = e
    raise RuntimeError(f"Failed to generate MCQs after {retries} attempts") from last_error


def generate_all_mcqs(
    client: genai.Client,
    model_name: str,
    chunks: list[str],
    questions_per_chunk: int = 2,
    concurrency: int = 4,
    retries: int = 2,
) -> list[dict]:
    """Generate MCQs for every chunk in the document (not just a sampled
    subset), so the final set covers the whole PDF. Chunks are requested
    concurrently (network round-trip latency dominates, not local CPU) since
    a serial one-call-per-chunk loop is what makes this slow on longer PDFs.
    Duplicate questions (e.g. from overlapping chunk content) are dropped.
    """

    def worker(idx: int, chunk: str) -> tuple[int, list[dict]]:
        try:
            return idx, generate_mcqs_safe(client, model_name, [chunk], questions_per_chunk, retries=retries)
        except RuntimeError as e:
            print(f"Warning: skipping chunk {idx + 1}/{len(chunks)} after failure: {e}", file=sys.stderr)
            return idx, []

    results: list[list[dict]] = [[] for _ in chunks]
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(worker, idx, chunk) for idx, chunk in enumerate(chunks)]
        for future in concurrent.futures.as_completed(futures):
            idx, mcqs = future.result()
            results[idx] = mcqs

    all_mcqs: list[dict] = []
    seen_questions: set[str] = set()
    for mcqs in results:
        for mcq in mcqs:
            key = mcq["question"].strip().lower()
            if key in seen_questions:
                continue
            seen_questions.add(key)
            all_mcqs.append(mcq)

    for i, mcq in enumerate(all_mcqs, 1):
        mcq["id"] = f"q{i}"

    return all_mcqs


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate MCQs (with explanations) covering an entire PDF, using Google Gemini."
    )
    parser.add_argument("pdf_path", help="Path to the PDF file")
    parser.add_argument(
        "--questions-per-chunk",
        type=int,
        default=4,
        help="Number of MCQs to generate per document chunk (default: 4). Total questions "
        "scales with document length since every chunk is covered.",
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=4000,
        help="Target characters per chunk (default: 4000). Each chunk costs one API call, and free-tier "
        "Gemini keys have tight daily request quotas, so bigger chunks (fewer, larger calls) are the "
        "default. Lower this for more granular coverage if your quota allows it.",
    )
    parser.add_argument(
        "--max-chunks",
        type=int,
        default=20,
        help="Hard cap on number of chunks processed, i.e. on API calls made in one run (default: 20) "
        "-- kept conservative to avoid burning through a free-tier daily quota in a single run.",
    )
    parser.add_argument(
        "-n",
        "--max-questions",
        type=int,
        default=None,
        help="Optional cap on the total number of questions kept (default: no cap, keep all).",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=4,
        help="Number of chunks to request from the API in parallel (default: 4). Raise this to "
        "speed up generation on longer PDFs; lower it if you hit free-tier rate limits.",
    )
    parser.add_argument("--retries", type=int, default=2, help="Retries per chunk on generation failure (default: 2)")
    parser.add_argument(
        "--model",
        default="gemini-3.5-flash-lite",
        help="Model to use (default: gemini-3.5-flash-lite). Lite models tend to have more generous "
        "free-tier daily quotas, which matters here since this makes one API call per chunk. Use a "
        "current Gemini model from AI Studio if Google updates names again.",
    )
    parser.add_argument(
        "-o",
        "--output",
        default="mcqs.json",
        help="Path to write the MCQs + explanations as JSON (default: mcqs.json)",
    )
    args = parser.parse_args()

    client = configure_client()
    text = extract_text(args.pdf_path)
    chunks = chunk_text(text, target_size=args.chunk_size, max_chunks=args.max_chunks)
    print(f"Extracted {len(chunks)} chunk(s) from {args.pdf_path}; generating questions for each...")

    mcqs = generate_all_mcqs(
        client,
        args.model,
        chunks,
        questions_per_chunk=args.questions_per_chunk,
        concurrency=args.concurrency,
        retries=args.retries,
    )

    if args.max_questions:
        mcqs = mcqs[: args.max_questions]

    for i, mcq in enumerate(mcqs, 1):
        print(f"\nQ{i} [{mcq['id']}]: {mcq['question']}")
        for option_index, option in enumerate(mcq["options"], start=1):
            letter = chr(64 + option_index)
            prefix = "*" if letter.upper() == str(mcq["correct_answer"]).upper() else " "
            print(f"  {prefix} {letter}. {option}")
        print(f"Correct answer: {mcq['correct_answer']}")
        print(f"Explanation: {mcq['explanation']}")

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(mcqs, f, indent=2)
    print(f"\nSaved {len(mcqs)} MCQs (with explanations) to {args.output}")


if __name__ == "__main__":
    main()
