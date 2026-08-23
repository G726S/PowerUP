"""Thin bridge into the top-level pdf_qa_agent.py pipeline (kept in place at the
repo root per how the ingestion pipeline was originally built and tuned), plus
the chapter/flashcard generation steps built on top of it for the study UI.

DEPENDS ON pdf_qa_agent.py's get_client(), cache_paths(), get_or_create_context(),
and generate_mcq_batch_safe() -- see the "BACKEND INTEGRATION NOTE" at the top of
that file. If pdf_qa_agent.py is swapped for an updated version, check those
four calls below still match its signatures."""

import sys
from pathlib import Path
from typing import List, Optional

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import pdf_qa_agent  # noqa: E402
from google.genai import errors as genai_errors  # noqa: E402
from google.genai import types  # noqa: E402
from pydantic import BaseModel  # noqa: E402

MODEL = "gemini-3.6-flash"
CACHE_DIR = ROOT_DIR / ".pdf_qa_cache"

RATE_LIMIT_MESSAGE = (
    "The AI service is rate-limited right now (free-tier daily quota "
    "reached) -- this isn't a problem with your file. Try again later."
)
UNAVAILABLE_MESSAGE = (
    "The AI service timed out or is temporarily unavailable -- this isn't a "
    "problem with your file. Try again in a moment."
)


def friendly_error_message(exc: Exception, fallback: str) -> str:
    """Give quota/rate-limit and transient-outage failures (both realistic on
    the Gemini free tier) an accurate message instead of blaming the user's
    file for an unrelated API-side issue."""
    if isinstance(exc, genai_errors.APIError):
        if exc.code == 429:
            return RATE_LIMIT_MESSAGE
        if exc.code == 503:
            return UNAVAILABLE_MESSAGE
    return fallback


class ChapterItem(BaseModel):
    title: str
    summary: str


class FlashcardItem(BaseModel):
    front: str
    back: str


def ingest_material(pdf_path: str) -> None:
    """Distill the uploaded PDF into a cached study context so chapter/question
    generation is instant when it runs. Raises on failure -- the caller is
    responsible for recording the error."""
    client = pdf_qa_agent.get_client()
    context_path, _bank_path = pdf_qa_agent.cache_paths(pdf_path, str(CACHE_DIR))
    pdf_qa_agent.get_or_create_context(client, pdf_path, MODEL, context_path)


def load_cached_context(pdf_path: str) -> str:
    """Read back the study context cached by ingest_material. Assumes the
    material already finished ingesting successfully."""
    context_path, _bank_path = pdf_qa_agent.cache_paths(pdf_path, str(CACHE_DIR))
    with open(context_path, "r", encoding="utf-8") as f:
        return f.read()


def generate_chapter_for_material(context_text: str) -> dict:
    """One LLM call: turn one uploaded PDF's distilled study context into a
    single chapter (title + summary) -- one chapter per material, so a
    course's chapter list grows one at a time as PDFs are added."""
    client = pdf_qa_agent.get_client()
    prompt = (
        "Produce a single study chapter summarizing the material below, for a "
        "student to work through. Give a short title (2-6 words, textbook-style, "
        "e.g. 'Alkanes' or 'Supervised Learning') and a summary (4-8 sentences) "
        "covering the key concepts, definitions, and facts, grounded only in "
        "the material below.\n\n--- Study context ---\n" + context_text
    )
    response = client.models.generate_content(
        model=MODEL,
        contents=[prompt],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=ChapterItem,
        ),
    )
    if response.parsed is None:
        raise RuntimeError("Model returned no chapter")
    return response.parsed.model_dump()


def generate_flashcards(
    chapter_title: str, chapter_summary: str, count: int = 10
) -> List[dict]:
    """One LLM call: generate a browsable flashcard deck for a single chapter."""
    client = pdf_qa_agent.get_client()
    prompt = (
        f"Generate exactly {count} study flashcards for the chapter '{chapter_title}', "
        "strictly grounded in the chapter summary below -- do not introduce facts "
        "not present in it. Each flashcard has a 'front' (a term, question, or "
        "prompt) and a 'back' (a concise answer or definition, 1-2 sentences).\n\n"
        "--- Chapter summary ---\n" + chapter_summary
    )
    response = client.models.generate_content(
        model=MODEL,
        contents=[prompt],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=list[FlashcardItem],
        ),
    )
    items = response.parsed if response.parsed is not None else []
    return [item.model_dump() for item in items]


def generate_quiz(
    chapter_title: str,
    chapter_summary: str,
    count: int = 5,
    exclude_questions: Optional[List[str]] = None,
) -> List[dict]:
    """Reuses the existing MCQ pipeline from pdf_qa_agent.py, scoped to one
    chapter's summary instead of a whole document."""
    client = pdf_qa_agent.get_client()
    context_text = f"Chapter: {chapter_title}\n\n{chapter_summary}"
    return pdf_qa_agent.generate_mcq_batch_safe(
        client, context_text, count, MODEL, exclude_questions or []
    )
