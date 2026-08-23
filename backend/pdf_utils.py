"""PDF -> distilled study context, via Gemini's multimodal PDF reading (not
plain text extraction) -- this captures diagrams, tables, and figures that
text-only extraction misses. Distilled once per unique PDF and cached to
disk keyed by content hash, so re-uploading the same file (even after a
server restart) never re-spends an expensive multimodal call."""

import hashlib
import os

from google.genai import types

from gemini_client import MODEL_NAME, call_with_backoff, client

CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".pdf_context_cache")
INLINE_SIZE_LIMIT = 19 * 1024 * 1024  # Gemini's inline-request limit is ~20MB

ADMIN_EXCLUSION_RULE = (
    "Do NOT include course administration -- skip anything about assignment due "
    "dates, marks or weighting, submission requirements, semester schedule, or "
    "grading. If the material is purely administrative, leave it out entirely."
)


def _content_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def _cache_path(content_hash: str) -> str:
    os.makedirs(CACHE_DIR, exist_ok=True)
    return os.path.join(CACHE_DIR, f"{content_hash}.txt")


def _load_pdf_part(data: bytes, filename: str):
    if len(data) <= INLINE_SIZE_LIMIT:
        return types.Part.from_bytes(data=data, mime_type="application/pdf")

    os.makedirs(CACHE_DIR, exist_ok=True)
    tmp_path = os.path.join(CACHE_DIR, f"_upload_{filename}")
    with open(tmp_path, "wb") as f:
        f.write(data)
    try:
        return call_with_backoff(client.files.upload, file=tmp_path)  # large PDFs: upload instead of inlining
    finally:
        os.remove(tmp_path)


def distill_context(data: bytes, filename: str) -> str:
    """One-time, expensive call: read the raw PDF and produce a clean technical
    study context in plain text. This is the only step that ever touches the
    original PDF file -- everything downstream (MCQs, flashcards, summary,
    video script) reads this distilled text instead."""
    pdf_part = _load_pdf_part(data, filename)
    prompt = (
        "Produce a clean, structured technical study context from this PDF, "
        "organized by topic. Capture every technical concept, definition, formula, "
        "comparison, diagram, and example -- including facts that live only in "
        "diagrams/images, not just body text. Write out diagram content in words "
        "(e.g. describe what a diagram compares or shows). "
        + ADMIN_EXCLUSION_RULE
        + " Output plain text, organized with headings."
    )
    response = call_with_backoff(client.models.generate_content, model=MODEL_NAME, contents=[pdf_part, prompt])
    if not response.text or not response.text.strip():
        raise ValueError(f"Gemini returned no distilled content for '{filename}'.")
    return response.text


def get_or_create_context(data: bytes, filename: str) -> str:
    """Returns the distilled study context for this PDF's exact bytes,
    reading from a disk cache keyed by content hash when available."""
    if not data:
        raise ValueError(f"'{filename}' is empty.")

    cache_path = _cache_path(_content_hash(data))
    if os.path.exists(cache_path):
        with open(cache_path, "r", encoding="utf-8") as f:
            return f.read()

    context_text = distill_context(data, filename)
    with open(cache_path, "w", encoding="utf-8") as f:
        f.write(context_text)
    return context_text
