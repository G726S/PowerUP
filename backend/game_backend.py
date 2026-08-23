"""FastAPI session/API orchestration layer. The actual generation logic
(prompts, parsing, TTS, video assembly) lives in separate modules so a
failure is easy to trace to its source:
  - mcq_generator.py       MCQs used by the game
  - flashcard_generator.py flashcards
  - summary_generator.py   the PDF study-summary text
  - video_generator.py     the narrated video summary pipeline
  - pdf_utils.py           PDF -> distilled study context (+ disk cache)
  - text_dedup.py          near-duplicate text matching
  - gemini_client.py       shared Gemini client + model names
This file wires them together: sessions, courses, chapters, background-task
scheduling, and the HTTP endpoints.

Model: a session holds one or more "courses" (e.g. "Machine Learning",
"Maths") that stay stored side by side -- switching to a new course never
loses another one's material or progress. Each course holds one or more
"chapters," and each chapter is built from one or more uploaded PDFs (add a
second PDF to the same chapter_id to merge extra material into it). A
chapter owns its own study context, MCQ pool, flashcards, summary, and
video. Uploading a PDF kicks off ALL of that generation in the background
immediately -- nothing waits for the user to click into a tab.

The game is scoped to ONE course at a time: it pools questions across every
chapter *within that course* (not across other courses), tracks which have
been asked, and tops up whichever chapter in the course has the smallest
pool once the unasked count runs low -- all without the player ever seeing
a "generate" button. Power and answer history live on the course, not the
session, since playing the ML course and the Maths course are separate
play-throughs with separate progress.
"""

import json
import os
import random
import re
import sys
import tempfile
import threading
from typing import Any
from uuid import uuid4

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from flashcard_generator import generate_flashcards_from_text
from gemini_client import LIGHT_MARKDOWN_RULE, MODEL_NAME, call_with_backoff, client, friendly_error_message
from mcq_generator import generate_mcqs_from_text
from mcq_pdf import generate_mcq_pdf
from meme_client import get_random_meme
from notes_generator import generate_easy_notes, generate_notes_pdf
from tutor_chat import ask_tutor
from pdf_utils import get_or_create_context
from session_store import load_session, save_session
from summary_generator import generate_chapter_title, generate_pdf_summary
from text_dedup import is_near_duplicate
from video_generator import build_narrated_video

app = FastAPI(title="PDF MCQ Game Backend")

# Dev-only: lets a locally-opened test page (or a frontend on another port)
# call this API from the browser. Tighten this before any real deployment.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

VIDEO_DIR = tempfile.mkdtemp(prefix="pdf_qa_videos_")
NOTES_DIR = tempfile.mkdtemp(prefix="pdf_qa_notes_")
MCQ_PDF_DIR = tempfile.mkdtemp(prefix="pdf_qa_mcq_pdfs_")
SESSIONS: dict[str, dict[str, Any]] = {}

TOPUP_BATCH_SIZE = 8
TOPUP_THRESHOLD_FRACTION = 0.5  # trigger background top-up once this fraction of the pool has been used up
TOPUP_MIN_THRESHOLD = 4  # ...but never let a tiny pool wait for "50% used" to mean just 1-2 questions


def _auto_mcq_count(context_len: int) -> int:
    return max(8, min(30, context_len // 400))


def _auto_flashcard_count(context_len: int) -> int:
    return max(8, min(30, context_len // 400))


def _auto_notes_topics(context_len: int) -> int:
    # Each topic has ~10 structured-output fields (heading/explanation plus
    # every diagram type's fields), so this is kept lower than the MCQ/
    # flashcard caps to avoid truncating the response (generate_notes_topics
    # retries with fewer topics itself if a request still comes back short).
    return max(4, min(8, context_len // 1200))


def _auto_handwritten_notes_topics(context_len: int) -> int:
    # generate_notes_topics generates one topic per API call now (see its
    # docstring -- batching several elaborate topics into one structured
    # response proved unreliable), so this only controls how many
    # sequential calls happen, not per-call response size/reliability.
    return max(4, min(8, context_len // 1200))


def _auto_video_beats(context_len: int) -> int:
    # Each "beat" is one short visual moment (its own diagram); several
    # beats share one narration audio call (video_generator.BEATS_PER_SEGMENT
    # per call), so beat count can scale generously for full-document
    # coverage while TTS-call count (the actually scarce resource -- the
    # free tier is 10 requests/day total, shared across every video
    # generated that day) stays low: ~9-20 beats is only ~3-7 TTS calls.
    # //700 (not a smaller divisor) deliberately asks for somewhat fewer
    # beats than the raw content length might suggest -- overshooting past
    # what a document actually supports just produces near-duplicate/failed
    # beats once the model runs out of genuinely distinct material to cover.
    return max(9, min(20, context_len // 700))


class AnswerSubmission(BaseModel):
    session_id: str
    course_id: str
    question_id: str
    question: str
    selected_answer: str
    correct_answer: str
    explanation: str
    difficulty: str = "medium"
    topic: str = "general"


def _get_session_or_404(session_id: str) -> dict[str, Any]:
    session = SESSIONS.get(session_id)
    if session:
        return session
    # Not in memory (e.g. the server restarted) -- try disk before giving up,
    # so closing the app and coming back later doesn't lose progress.
    loaded = load_session(session_id)
    if loaded:
        SESSIONS[session_id] = loaded
        return loaded
    raise HTTPException(status_code=404, detail="Session not found.")


def _persist(session_id: str) -> None:
    """Best-effort save after any mutation. Never lets a disk hiccup break
    the actual request/background task that triggered it."""
    session = SESSIONS.get(session_id)
    if not session:
        return
    try:
        save_session(session)
    except Exception as e:  # noqa: BLE001
        print(f"Warning: failed to persist session {session_id}: {e}", file=sys.stderr)


def _get_course_or_404(session_id: str, course_id: str) -> dict[str, Any]:
    session = _get_session_or_404(session_id)
    course = session["courses"].get(course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found.")
    return course


def _get_chapter_or_404(session_id: str, course_id: str, chapter_id: str) -> dict[str, Any]:
    course = _get_course_or_404(session_id, course_id)
    chapter = course["chapters"].get(chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found.")
    return chapter


def _new_course(course_id: str, title: str) -> dict[str, Any]:
    return {
        "course_id": course_id,
        "title": title,
        "chapters": {},
        "power": 100,
        "rounds_played": 1,
        "questions": [],  # full cumulative answer log, across every round -- powers the dashboard
        "mistakes": [],  # cumulative log of wrong answers, across every round
        "correct_count": 0,  # cumulative correct-answer count, across every round
        "asked_this_round": set(),  # question_ids shown in the CURRENT round -- cleared by end-round
        "wrong_ids": set(),  # question_ids currently "due for review" (last answered wrong)
        "mastered_ids": set(),  # question_ids answered correctly at least once -- retired from serving
        "content_exhausted": False,  # true once top-ups stop finding genuinely new questions
        "topup_empty_streak": 0,
        "chat_history": [],  # [{"role": "user"|"assistant", "text": ...}, ...] with the AI tutor
    }


def _new_chapter(chapter_id: str, title: str) -> dict[str, Any]:
    return {
        "chapter_id": chapter_id,
        "title": title,
        "sources": [],
        "context": None,
        "status": "processing",  # processing | ready | error
        "status_error": None,
        "all_mcqs": [],
        "seen_question_texts": set(),
        "question_counter": 0,
        "flashcards": [],
        "seen_flashcard_texts": set(),
        "pdf_summary": None,
        "easy_notes": None,  # list of {heading, explanation} -- plain readable notes, viewed in-app
        "easy_notes_error": None,
        "handwritten_notes_path": None,  # notebook-styled PDF with diagrams
        "handwritten_notes_error": None,
        "video_status": "none",  # none | generating | ready | error
        "video_path": None,
        "video_error": None,
        "generating_mcqs": False,
        "generating_remedial_flashcards": False,
        "regenerating_title": False,
        "lock": threading.Lock(),
    }


def _dedupe_and_add_mcqs(chapter: dict[str, Any], new_mcqs: list[dict[str, Any]]) -> int:
    added = 0
    with chapter["lock"]:
        for mcq in new_mcqs:
            key = mcq["question"].strip().lower()
            if key in chapter["seen_question_texts"] or is_near_duplicate(key, chapter["seen_question_texts"]):
                continue
            chapter["seen_question_texts"].add(key)
            chapter["question_counter"] += 1
            mcq["question_id"] = f"{chapter['chapter_id']}_q{chapter['question_counter']}"
            mcq["chapter_id"] = chapter["chapter_id"]
            chapter["all_mcqs"].append(mcq)
            added += 1
    return added


def _dedupe_and_add_flashcards(chapter: dict[str, Any], new_cards: list[dict[str, Any]]) -> int:
    added = 0
    with chapter["lock"]:
        for card in new_cards:
            key = card["front"].strip().lower()
            if key in chapter["seen_flashcard_texts"] or is_near_duplicate(key, chapter["seen_flashcard_texts"]):
                continue
            chapter["seen_flashcard_texts"].add(key)
            chapter["flashcards"].append(card)
            added += 1
    return added


_TOPIC_STOPWORDS = {"the", "a", "an", "of", "and", "or", "in", "on", "for", "to", "is", "are", "with", "its"}


def _topic_words(topic: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", topic.lower()) if len(w) >= 4 and w not in _TOPIC_STOPWORDS}


def _topic_matches_any(card_topic: str, weak_topics: dict[str, int]) -> bool:
    """MCQs and flashcards are tagged with 'topic' by separate generation
    calls, so the exact strings rarely line up word-for-word even for the
    same concept ("Newton's second law" vs "second law of motion") --
    matching on shared significant words is far more forgiving than an
    exact/substring match while still being a real concept signal."""
    card_words = _topic_words(card_topic)
    if not card_words:
        return False
    return any(card_words & _topic_words(weak) for weak in weak_topics)


def _weak_topics_from_history(course: dict[str, Any]) -> dict[str, int]:
    """topic -> how many times it's been answered wrong, across the full
    cumulative history. "general" (the fallback when no real topic was
    tagged) is excluded -- it's not a real concept, so treating it as
    "weak" would just shuffle everything without signal."""
    topics: dict[str, int] = {}
    for q in course.get("questions", []):
        if q["is_correct"]:
            continue
        topic = (q.get("topic") or "general").strip()
        if not topic or topic.lower() == "general":
            continue
        topics[topic] = topics.get(topic, 0) + 1
    return topics


def _combined_mcq_pool(course: dict[str, Any]) -> list[dict[str, Any]]:
    pool: list[dict[str, Any]] = []
    for chapter in course["chapters"].values():
        pool.extend(chapter["all_mcqs"])
    return pool


def _combined_course_context(course: dict[str, Any]) -> str:
    """All of a course's chapter study contexts, concatenated -- what the
    tutor chat is grounded in, so it knows everything uploaded to this
    course (not just one chapter)."""
    parts = [c["context"] for c in course["chapters"].values() if c.get("context")]
    return "\n\n".join(parts)


def generate_video_summary(session_id: str, course_id: str, chapter_id: str, num_beats: int) -> None:
    session = SESSIONS.get(session_id)
    if not session:
        return
    course = session["courses"].get(course_id)
    if not course:
        return
    chapter = course["chapters"].get(chapter_id)
    if not chapter:
        return

    out_path = os.path.join(VIDEO_DIR, f"{session_id}_{course_id}_{chapter_id}.mp4")
    try:
        beats = build_narrated_video(chapter["context"], num_beats, out_path)
        chapter["video_path"] = out_path
        chapter["video_status"] = "ready"
        print(f"[video] chapter {chapter_id}: ready ({len(beats)} beats)")
    except Exception as e:  # noqa: BLE001
        chapter["video_status"] = "error"
        chapter["video_error"] = friendly_error_message(e)
        print(f"Warning: video generation failed for chapter {chapter_id}: {e}", file=sys.stderr)
    _persist(session_id)


def process_chapter(session_id: str, course_id: str, chapter_id: str, pdf_bytes: bytes, filename: str) -> None:
    """The whole auto-generation pipeline for one uploaded PDF: distill its
    study context, then generate MCQs, flashcards, and a summary from it --
    all before the user has clicked into any tab. Runs as a background task
    so the upload request itself returns immediately. Video is kicked off
    on its own thread as soon as the core content is ready, running
    concurrently with the (also slow) notes generation below instead of
    waiting for it -- the two don't touch the same chapter fields, so
    there's nothing to serialize."""
    session = SESSIONS.get(session_id)
    if not session:
        return
    course = session["courses"].get(course_id)
    if not course:
        return
    chapter = course["chapters"].get(chapter_id)
    if not chapter:
        return

    try:
        new_context = get_or_create_context(pdf_bytes, filename)
        chapter["context"] = f"{chapter['context']}\n\n{new_context}" if chapter.get("context") else new_context
        chapter["sources"].append(filename)
        context_len = len(chapter["context"])

        # Best-effort -- a failure here just leaves the filename as the
        # title (the old behavior), it doesn't fail the whole chapter.
        try:
            chapter["title"] = generate_chapter_title(chapter["context"])
        except Exception as e:  # noqa: BLE001
            print(f"Warning: title generation failed for chapter {chapter_id}, keeping filename: {e}", file=sys.stderr)

        mcqs = generate_mcqs_from_text(chapter["context"], _auto_mcq_count(context_len))
        _dedupe_and_add_mcqs(chapter, mcqs)

        flashcards = generate_flashcards_from_text(chapter["context"], _auto_flashcard_count(context_len))
        _dedupe_and_add_flashcards(chapter, flashcards)

        chapter["pdf_summary"] = generate_pdf_summary(chapter["context"])

        chapter["status"] = "ready"
        print(
            f"[chapter] {chapter_id}: ready "
            f"({len(chapter['all_mcqs'])} mcqs, {len(chapter['flashcards'])} cards)"
        )
    except Exception as e:  # noqa: BLE001
        chapter["status"] = "error"
        chapter["status_error"] = friendly_error_message(e)
        print(f"Warning: chapter {chapter_id} processing failed: {e}", file=sys.stderr)
        _persist(session_id)
        return

    chapter["video_status"] = "generating"
    video_thread = threading.Thread(
        target=generate_video_summary,
        args=(session_id, course_id, chapter_id, _auto_video_beats(context_len)),
        daemon=True,
    )
    video_thread.start()

    # Notes (both kinds) are a nice-to-have alongside the core content -- a
    # failure here shouldn't mark the whole chapter as errored when
    # MCQs/flashcards/summary already succeeded.
    try:
        chapter["easy_notes"] = generate_easy_notes(chapter["context"], _auto_notes_topics(context_len))
        print(f"[easy-notes] chapter {chapter_id}: ready ({len(chapter['easy_notes'])} topics)")
    except Exception as e:  # noqa: BLE001
        chapter["easy_notes_error"] = friendly_error_message(e)
        print(f"Warning: easy-notes generation failed for chapter {chapter_id}: {e}", file=sys.stderr)

    try:
        notes_path = os.path.join(NOTES_DIR, f"{session_id}_{course_id}_{chapter_id}.pdf")
        generate_notes_pdf(chapter["context"], _auto_handwritten_notes_topics(context_len), notes_path)
        chapter["handwritten_notes_path"] = notes_path
        print(f"[handwritten-notes] chapter {chapter_id}: ready")
    except Exception as e:  # noqa: BLE001
        chapter["handwritten_notes_error"] = friendly_error_message(e)
        print(f"Warning: handwritten-notes generation failed for chapter {chapter_id}: {e}", file=sys.stderr)

    video_thread.join()
    _persist(session_id)


def _looks_like_filename(title: str) -> bool:
    """True for a title that's just the raw uploaded filename (chapters
    created before real title generation existed, or ones where it failed)
    -- the tell is a file extension still on the end, which no real
    generated title would ever have."""
    return title.strip().lower().endswith((".pdf", ".ppt", ".pptx", ".doc", ".docx"))


def backfill_chapter_title(session_id: str, course_id: str, chapter_id: str) -> None:
    """Regenerates a real title for a chapter that's still stuck showing its
    raw filename (created before chapter titles were auto-generated) --
    otherwise the chapter view shows the same PDF name twice: once as the
    source label, once again as the heading, with nothing done about it
    until the student happens to re-upload."""
    session = SESSIONS.get(session_id)
    if not session:
        return
    course = session["courses"].get(course_id)
    if not course:
        return
    chapter = course["chapters"].get(chapter_id)
    if not chapter or chapter["status"] != "ready" or chapter["regenerating_title"] or not chapter.get("context"):
        return

    chapter["regenerating_title"] = True
    try:
        chapter["title"] = generate_chapter_title(chapter["context"])
        print(f"[title-backfill] chapter {chapter_id}: retitled to '{chapter['title']}'")
    except Exception as e:  # noqa: BLE001
        print(f"Warning: title backfill failed for chapter {chapter_id}: {e}", file=sys.stderr)
    finally:
        chapter["regenerating_title"] = False
        _persist(session_id)


TOPUP_EXHAUSTION_STREAK = 2  # consecutive empty top-ups before we stop trying (content genuinely covered)


def top_up_questions(session_id: str, course_id: str) -> None:
    """Generates another batch of non-duplicate questions into whichever
    ready chapter in this course currently has the smallest MCQ pool,
    keeping coverage balanced across the course's chapters as it grows.
    Tracks consecutive no-op top-ups (every candidate came back a
    near-duplicate) as a signal that the material's genuinely covered, so
    the course can eventually say "mastered" instead of generating forever."""
    session = SESSIONS.get(session_id)
    if not session:
        return
    course = session["courses"].get(course_id)
    if not course or course["content_exhausted"]:
        return

    candidates = [c for c in course["chapters"].values() if c["status"] == "ready" and not c["generating_mcqs"]]
    if not candidates:
        return
    chapter = min(candidates, key=lambda c: len(c["all_mcqs"]))

    chapter["generating_mcqs"] = True
    try:
        avoid = list(chapter["seen_question_texts"])[-40:]  # keep the prompt bounded
        new_mcqs = generate_mcqs_from_text(chapter["context"], TOPUP_BATCH_SIZE, avoid_questions=avoid)
        added = _dedupe_and_add_mcqs(chapter, new_mcqs)
        print(f"[top-up] chapter {chapter['chapter_id']}: added {added}, pool now {len(chapter['all_mcqs'])}")

        if added == 0:
            course["topup_empty_streak"] += 1
            if course["topup_empty_streak"] >= TOPUP_EXHAUSTION_STREAK:
                course["content_exhausted"] = True
                print(f"[top-up] course {course_id}: content exhausted, no more distinct questions available")
        else:
            course["topup_empty_streak"] = 0
    except Exception as e:  # noqa: BLE001
        print(f"Warning: top-up failed for chapter {chapter['chapter_id']}: {e}", file=sys.stderr)
    finally:
        chapter["generating_mcqs"] = False
        _persist(session_id)


REMEDIAL_FLASHCARD_BATCH_SIZE = 4
REMEDIAL_FLASHCARD_MIN_MATCHES = 2  # below this many existing cards on a weak topic, generate more


def top_up_remedial_flashcards(session_id: str, course_id: str, chapter_id: str) -> None:
    """Generates a small batch of flashcards concentrated on whichever
    concepts the learner has been getting MCQs wrong on -- struggling
    topics get MORE review material, not just a re-ordering of what
    already exists."""
    session = SESSIONS.get(session_id)
    if not session:
        return
    course = session["courses"].get(course_id)
    if not course:
        return
    chapter = course["chapters"].get(chapter_id)
    if not chapter or chapter["status"] != "ready" or chapter["generating_remedial_flashcards"]:
        return

    weak_topics = _weak_topics_from_history(course)
    if not weak_topics:
        return
    top_weak = [t for t, _ in sorted(weak_topics.items(), key=lambda x: -x[1])[:3]]

    chapter["generating_remedial_flashcards"] = True
    try:
        avoid = list(chapter["seen_flashcard_texts"])[-40:]  # keep the prompt bounded
        new_cards = generate_flashcards_from_text(
            chapter["context"], REMEDIAL_FLASHCARD_BATCH_SIZE, avoid_fronts=avoid, focus_topics=top_weak
        )
        added = _dedupe_and_add_flashcards(chapter, new_cards)
        print(f"[remedial-flashcards] chapter {chapter_id}: added {added} for weak topics {top_weak}")
    except Exception as e:  # noqa: BLE001
        print(f"Warning: remedial flashcard top-up failed for chapter {chapter_id}: {e}", file=sys.stderr)
    finally:
        chapter["generating_remedial_flashcards"] = False
        _persist(session_id)


@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/meme")
def get_meme() -> dict[str, str]:
    """A random SFW meme -- not scoped to any session/course, shown as a
    study break interleaved between flashcards on the frontend."""
    try:
        return get_random_meme()
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@app.post("/api/session/new")
def create_session() -> dict[str, Any]:
    session_id = uuid4().hex
    SESSIONS[session_id] = {"session_id": session_id, "courses": {}}
    _persist(session_id)
    return {"session_id": session_id}


@app.get("/api/session/{session_id}")
def check_session(session_id: str) -> dict[str, Any]:
    """Lets the frontend check whether a session_id remembered in
    localStorage is still valid (in memory or recoverable from disk) before
    deciding to reuse it vs. starting a brand new one."""
    _get_session_or_404(session_id)
    return {"session_id": session_id}


@app.post("/api/session/{session_id}/courses")
def create_course(session_id: str, title: str) -> dict[str, Any]:
    session = _get_session_or_404(session_id)
    course_id = uuid4().hex
    session["courses"][course_id] = _new_course(course_id, title)
    _persist(session_id)
    return {"course_id": course_id, "title": title, "power": 100}


@app.get("/api/session/{session_id}/courses")
def list_courses(session_id: str) -> dict[str, Any]:
    session = _get_session_or_404(session_id)
    return {
        "courses": [
            {
                "course_id": c["course_id"],
                "title": c["title"],
                "chapter_count": len(c["chapters"]),
                "mcq_count": len(_combined_mcq_pool(c)),
                "power": c["power"],
                "correct_count": c["correct_count"],
                "mastered_count": len(c["mastered_ids"]),
                "review_due_count": len(c["wrong_ids"]),
                "content_exhausted": c["content_exhausted"],
                "rounds_played": c["rounds_played"],
            }
            for c in session["courses"].values()
        ]
    }


@app.delete("/api/session/{session_id}/courses/{course_id}")
def delete_course(session_id: str, course_id: str) -> dict[str, Any]:
    """Removes an entire course (all its chapters, MCQs, notes, videos, and
    tutor chat history) from the session. Other courses in the session are
    untouched."""
    session = _get_session_or_404(session_id)
    course = session["courses"].pop(course_id, None)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found.")

    for chapter in course["chapters"].values():
        _delete_chapter_files(chapter)

    _persist(session_id)
    return {"deleted": True, "course_id": course_id}


@app.post("/api/session/{session_id}/courses/{course_id}/chapters")
async def upload_chapter(
    session_id: str,
    course_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    chapter_id: str | None = None,
    title: str | None = None,
) -> dict[str, Any]:
    """Upload a PDF into this course. Omit chapter_id to start a new
    chapter; pass an existing chapter_id to merge another PDF's material
    into it instead. Kicks off the full generation pipeline (MCQs,
    flashcards, summary, video) in the background and returns immediately --
    poll GET .../chapters for status."""
    course = _get_course_or_404(session_id, course_id)
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    data = await file.read()

    if chapter_id:
        chapter = course["chapters"].get(chapter_id)
        if not chapter:
            raise HTTPException(status_code=404, detail="Chapter not found.")
    else:
        chapter_id = uuid4().hex
        chapter = _new_chapter(chapter_id, title or file.filename)
        course["chapters"][chapter_id] = chapter

    chapter["status"] = "processing"
    chapter["status_error"] = None
    background_tasks.add_task(process_chapter, session_id, course_id, chapter_id, data, file.filename)
    _persist(session_id)

    return {"chapter_id": chapter_id, "status": "processing"}


@app.get("/api/session/{session_id}/courses/{course_id}/chapters")
def list_chapters(session_id: str, course_id: str, background_tasks: BackgroundTasks) -> dict[str, Any]:
    course = _get_course_or_404(session_id, course_id)

    # Chapters created before title auto-generation existed are still
    # showing their raw filename as the title -- catch those here (whatever
    # course a returning student happens to open) and fix them in the
    # background rather than leaving it permanently stuck.
    for c in course["chapters"].values():
        if c["status"] == "ready" and not c["regenerating_title"] and _looks_like_filename(c["title"]):
            background_tasks.add_task(backfill_chapter_title, session_id, course_id, c["chapter_id"])

    return {
        "chapters": [
            {
                "chapter_id": c["chapter_id"],
                "title": c["title"],
                "sources": c["sources"],
                "status": c["status"],
                "status_error": c["status_error"],
                "mcq_count": len(c["all_mcqs"]),
                "flashcard_count": len(c["flashcards"]),
                "video_status": c["video_status"],
                "easy_notes_ready": c["easy_notes"] is not None,
                "easy_notes_error": c["easy_notes_error"],
                "handwritten_notes_ready": c["handwritten_notes_path"] is not None,
                "handwritten_notes_error": c["handwritten_notes_error"],
            }
            for c in course["chapters"].values()
        ]
    }


def _delete_chapter_files(chapter: dict[str, Any]) -> None:
    for path in (chapter.get("video_path"), chapter.get("handwritten_notes_path")):
        if path:
            try:
                os.remove(path)
            except FileNotFoundError:
                pass


@app.delete("/api/session/{session_id}/courses/{course_id}/chapters/{chapter_id}")
def delete_chapter(session_id: str, course_id: str, chapter_id: str) -> dict[str, Any]:
    """Removes a chapter (an uploaded PDF, or a merged set of them) from a
    course -- its MCQs immediately drop out of the course's pool and its
    generated video/notes files are deleted from disk. Course-level state
    that isn't chapter-specific (power, cumulative answer history, rounds
    played) is left untouched; only this chapter's own questions are purged
    from the review/mastery tracking so no dangling ids linger."""
    course = _get_course_or_404(session_id, course_id)
    chapter = course["chapters"].pop(chapter_id, None)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found.")

    question_ids = {mcq["question_id"] for mcq in chapter["all_mcqs"]}
    course["asked_this_round"] -= question_ids
    course["wrong_ids"] -= question_ids
    course["mastered_ids"] -= question_ids

    _delete_chapter_files(chapter)

    _persist(session_id)
    return {"deleted": True, "chapter_id": chapter_id}


@app.get("/api/session/{session_id}/courses/{course_id}/chapters/{chapter_id}/summary")
def get_chapter_summary(session_id: str, course_id: str, chapter_id: str) -> dict[str, Any]:
    chapter = _get_chapter_or_404(session_id, course_id, chapter_id)
    return {"status": chapter["status"], "summary": chapter["pdf_summary"]}


@app.get("/api/session/{session_id}/courses/{course_id}/chapters/{chapter_id}/flashcards")
def get_chapter_flashcards(
    session_id: str, course_id: str, chapter_id: str, background_tasks: BackgroundTasks
) -> dict[str, Any]:
    """Flashcards whose topic matches something the learner has been
    getting MCQs wrong on (anywhere in this course) are surfaced first --
    review stacks on struggling concepts instead of appearing in generation
    order. If a weak topic doesn't have much matching material yet, this
    also kicks off a background top-up that generates more cards concentrated
    on exactly that concept, so struggling areas get MORE review, not just
    reordering of what already existed."""
    course = _get_course_or_404(session_id, course_id)
    chapter = course["chapters"].get(chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found.")

    cards = chapter["flashcards"]
    weak_topics = _weak_topics_from_history(course)
    if weak_topics and chapter["status"] == "ready":
        weak_matches = sum(1 for c in cards if _topic_matches_any(c.get("topic", ""), weak_topics))
        if weak_matches < REMEDIAL_FLASHCARD_MIN_MATCHES and not chapter["generating_remedial_flashcards"]:
            background_tasks.add_task(top_up_remedial_flashcards, session_id, course_id, chapter_id)
        cards = sorted(cards, key=lambda c: 0 if _topic_matches_any(c.get("topic", ""), weak_topics) else 1)

    return {"status": chapter["status"], "flashcards": cards}


@app.get("/api/session/{session_id}/courses/{course_id}/chapters/{chapter_id}/mcqs")
def get_chapter_mcqs(session_id: str, course_id: str, chapter_id: str) -> dict[str, Any]:
    chapter = _get_chapter_or_404(session_id, course_id, chapter_id)
    return {"status": chapter["status"], "mcqs": chapter["all_mcqs"]}


@app.get("/api/session/{session_id}/courses/{course_id}/chapters/{chapter_id}/notes")
def get_chapter_easy_notes(session_id: str, course_id: str, chapter_id: str) -> dict[str, Any]:
    """Plain, readable topic-by-topic notes with examples -- viewed directly
    in the app (not a file), generated automatically alongside everything
    else on upload."""
    chapter = _get_chapter_or_404(session_id, course_id, chapter_id)
    if chapter.get("easy_notes") is not None:
        return {"status": "ready", "notes": chapter["easy_notes"]}
    if chapter.get("easy_notes_error"):
        return {"status": "error", "notes": [], "error": chapter["easy_notes_error"]}
    return {"status": chapter["status"], "notes": []}


@app.get("/api/session/{session_id}/courses/{course_id}/chapters/{chapter_id}/handwritten-notes")
def get_chapter_handwritten_notes(session_id: str, course_id: str, chapter_id: str) -> FileResponse:
    """The AI-generated notebook-styled notes PDF for this chapter -- shorter
    per-topic text plus a diagram, generated automatically alongside
    everything else. Served inline (viewable in the browser/an <iframe>)
    rather than as a forced download -- the frontend adds its own explicit
    download link for anyone who wants to save it."""
    chapter = _get_chapter_or_404(session_id, course_id, chapter_id)
    if not chapter.get("handwritten_notes_path"):
        detail = chapter.get("handwritten_notes_error") or (
            "Notes not ready yet." if chapter["status"] == "processing" else "Notes were not generated."
        )
        raise HTTPException(status_code=409, detail=detail)
    return FileResponse(
        chapter["handwritten_notes_path"],
        media_type="application/pdf",
        filename="handwritten-notes.pdf",
        content_disposition_type="inline",
    )


@app.get("/api/session/{session_id}/courses/{course_id}/mcqs")
def list_course_mcqs(session_id: str, course_id: str) -> dict[str, Any]:
    """The full, ever-growing MCQ pool across every chapter in this course --
    same pool the game randomly draws from for this course."""
    course = _get_course_or_404(session_id, course_id)
    return {"mcqs": _combined_mcq_pool(course)}


@app.get("/api/session/{session_id}/courses/{course_id}/mcqs/pdf")
def download_course_mcqs_pdf(session_id: str, course_id: str) -> FileResponse:
    """A downloadable revision sheet -- every MCQ in this course's pool
    (question, options, correct answer, explanation) as a plain PDF. Built
    fresh on each request (the pool only grows, and rendering is cheap/local
    -- no LLM call involved), so it's always current, not a stale snapshot."""
    course = _get_course_or_404(session_id, course_id)
    mcqs = _combined_mcq_pool(course)
    if not mcqs:
        raise HTTPException(status_code=409, detail="No questions available yet.")
    out_path = os.path.join(MCQ_PDF_DIR, f"{session_id}_{course_id}_mcqs.pdf")
    generate_mcq_pdf(course["title"], mcqs, out_path)
    return FileResponse(
        out_path,
        media_type="application/pdf",
        filename=f"{course['title']}-mcqs.pdf",
        content_disposition_type="attachment",
    )


@app.get("/api/session/{session_id}/courses/{course_id}/chapters/{chapter_id}/video-summary/status")
def video_summary_status(session_id: str, course_id: str, chapter_id: str) -> dict[str, Any]:
    chapter = _get_chapter_or_404(session_id, course_id, chapter_id)
    return {"status": chapter["video_status"], "error": chapter.get("video_error")}


@app.get("/api/session/{session_id}/courses/{course_id}/chapters/{chapter_id}/video-summary")
def get_video_summary(session_id: str, course_id: str, chapter_id: str) -> FileResponse:
    chapter = _get_chapter_or_404(session_id, course_id, chapter_id)
    if chapter["video_status"] != "ready" or not chapter.get("video_path"):
        raise HTTPException(status_code=409, detail=f"Video not ready (status: {chapter['video_status']}).")
    return FileResponse(
        chapter["video_path"], media_type="video/mp4", filename="summary.mp4", content_disposition_type="inline"
    )


@app.post("/api/session/{session_id}/courses/{course_id}/chapters/{chapter_id}/video-summary/retry")
def retry_video_summary(
    session_id: str, course_id: str, chapter_id: str, background_tasks: BackgroundTasks
) -> dict[str, Any]:
    """Manual recovery path if video generation errored out -- not needed on
    the happy path, since video is triggered automatically after upload."""
    chapter = _get_chapter_or_404(session_id, course_id, chapter_id)
    if chapter["status"] != "ready":
        raise HTTPException(status_code=400, detail=f"Chapter not ready yet (status: {chapter['status']}).")
    if chapter["video_status"] == "generating":
        return {"status": "generating"}

    chapter["video_status"] = "generating"
    chapter["video_error"] = None
    background_tasks.add_task(
        generate_video_summary, session_id, course_id, chapter_id, _auto_video_beats(len(chapter["context"]))
    )
    return {"status": "generating"}


def _servable(course: dict[str, Any], pool: list[dict[str, Any]]) -> tuple[list, list]:
    """Splits the pool into (wrong_first, fresh) -- questions eligible to be
    served right now, i.e. not already asked this round and not mastered.
    Mastered (previously correct) questions are excluded entirely: once
    retired, they're not re-tested unless missed again in some later round."""
    candidates = [
        m for m in pool if m["question_id"] not in course["mastered_ids"] and m["question_id"] not in course["asked_this_round"]
    ]
    wrong_first = [m for m in candidates if m["question_id"] in course["wrong_ids"]]
    fresh = [m for m in candidates if m["question_id"] not in course["wrong_ids"]]
    return wrong_first, fresh


@app.get("/api/session/{session_id}/courses/{course_id}/next-question")
def get_next_question(session_id: str, course_id: str, background_tasks: BackgroundTasks) -> dict[str, Any]:
    """Picks the next question for THIS course only (other courses are
    completely isolated). Previously-wrong questions are prioritized over
    fresh ones -- spaced-repetition style -- and a question already
    answered correctly is retired (not re-served) unless missed again
    later. When there's nothing left to serve, kicks off a background
    top-up so the game never needs an explicit 'generate more' click. Once
    the course has zero questions due for review AND top-up genuinely can't
    find more distinct material, this returns {"mastered": true} instead of
    a question -- the material is done, not just temporarily out of stock.
    """
    course = _get_course_or_404(session_id, course_id)
    pool = _combined_mcq_pool(course)
    any_generating = any(c["generating_mcqs"] for c in course["chapters"].values())

    wrong_first, fresh = _servable(course, pool)

    if not wrong_first and not fresh and not course["content_exhausted"] and not any_generating:
        top_up_questions(session_id, course_id)  # synchronous fallback so this request can still return something
        pool = _combined_mcq_pool(course)
        wrong_first, fresh = _servable(course, pool)

    if wrong_first:
        question = random.choice(wrong_first)
    elif fresh:
        question = random.choice(fresh)
    else:
        if not pool:
            raise HTTPException(status_code=409, detail="No questions available yet -- try again shortly.")
        if not course["wrong_ids"] and course["content_exhausted"]:
            return {
                "mastered": True,
                "message": "You've answered every distinct question correctly, and there's no new material "
                "left to generate from this course -- nice work, this one's mastered.",
            }
        raise HTTPException(
            status_code=409,
            detail="Round complete -- everything available has already been shown this round. "
            "Call end-round to start a fresh one (anything answered wrong will come up first).",
        )

    course["asked_this_round"].add(question["question_id"])
    remaining = len(wrong_first) + len(fresh) - 1

    # Trigger a top-up once the servable pool is half used up (not a small
    # fixed number) -- so the question bank keeps growing as the player
    # progresses, well before it could ever run dry mid-session.
    topup_threshold = max(TOPUP_MIN_THRESHOLD, int(len(pool) * TOPUP_THRESHOLD_FRACTION))
    if remaining <= topup_threshold and not course["content_exhausted"] and not any_generating:
        background_tasks.add_task(top_up_questions, session_id, course_id)

    _persist(session_id)
    return {
        "question": question,
        "remaining_unasked": remaining,
        "is_review": question["question_id"] in course["wrong_ids"],
    }


@app.post("/api/session/{session_id}/courses/{course_id}/end-round")
def end_round(session_id: str, course_id: str) -> dict[str, Any]:
    """Call this when a play-through ends (power hit 0, the player quit,
    whatever the game defines as 'game over'). Makes the whole pool
    servable again for a fresh round -- with wrong-answered questions
    prioritized first -- and resets power to 100. Does NOT touch mastery
    state (wrong_ids/mastered_ids) or the cumulative answer history that
    powers the dashboard, so progress isn't lost, only the current round's
    'already shown' gate."""
    course = _get_course_or_404(session_id, course_id)
    course["asked_this_round"] = set()
    course["power"] = 100
    course["rounds_played"] += 1
    _persist(session_id)
    return {
        "rounds_played": course["rounds_played"],
        "power": course["power"],
        "review_due": len(course["wrong_ids"]),
        "mastered_count": len(course["mastered_ids"]),
    }


@app.post("/api/session/answer")
def submit_answer(payload: AnswerSubmission) -> dict[str, Any]:
    course = _get_course_or_404(payload.session_id, payload.course_id)

    is_correct = payload.selected_answer.strip().upper() == payload.correct_answer.strip().upper()
    record = {
        "question_id": payload.question_id,
        "question": payload.question,
        "selected_answer": payload.selected_answer.strip().upper(),
        "correct_answer": payload.correct_answer.strip().upper(),
        "is_correct": is_correct,
        "difficulty": payload.difficulty,
        "topic": payload.topic,
        "explanation": payload.explanation,
    }
    course["questions"].append(record)

    if is_correct:
        course["correct_count"] += 1
        course["power"] = min(100, course["power"] + 4)
        course["mastered_ids"].add(payload.question_id)  # retire it -- won't be re-served unless missed later
        course["wrong_ids"].discard(payload.question_id)
    else:
        course["power"] = max(0, course["power"] - 10)
        course["wrong_ids"].add(payload.question_id)  # due for review -- prioritized next time it's servable
        course["mastered_ids"].discard(payload.question_id)
        course["mistakes"].append({
            "question": payload.question,
            "selected_answer": payload.selected_answer.strip().upper(),
            "correct_answer": payload.correct_answer.strip().upper(),
            "explanation": payload.explanation,
            "difficulty": payload.difficulty,
            "topic": payload.topic,
        })

    _persist(payload.session_id)
    return {
        "is_correct": is_correct,
        "power": course["power"],
        "correct_count": course["correct_count"],
        "explanation": payload.explanation,
    }


def build_heuristic_summary(course: dict[str, Any]) -> str:
    questions = course.get("questions", [])
    if not questions:
        return "No questions have been answered yet."

    total = len(questions)
    correct = sum(1 for q in questions if q["is_correct"])
    difficulties: dict[str, int] = {}

    for q in questions:
        diff = q.get("difficulty", "medium")
        difficulties[diff] = difficulties.get(diff, 0) + (0 if q["is_correct"] else 1)

    weak_topics = _weak_topics_from_history(course)
    strongest = [k for k, v in difficulties.items() if v == min(difficulties.values())]
    weak_topic = max(weak_topics.items(), key=lambda x: x[1])[0] if weak_topics else "general"

    return (
        f"You answered {correct} out of {total} questions correctly. "
        f"Your main struggle was in {weak_topic}, where your mistakes were concentrated. "
        f"The hardest difficulty area was {strongest[0] if strongest else 'general'}; the session suggests you need more review there. "
        f"Focus on the explanation for wrong answers and revisit the concept before the next challenge."
    )


@app.get("/api/session/{session_id}/courses/{course_id}/summary")
def get_course_performance_summary(session_id: str, course_id: str) -> dict[str, Any]:
    course = _get_course_or_404(session_id, course_id)

    summary_text = build_heuristic_summary(course)

    # Only bother the model once there's something real to summarize -- with
    # an empty history it has nothing to work with and (seen live) responds
    # with a confused meta-comment asking to be given the data it wasn't,
    # instead of the clean "no questions yet" heuristic message above.
    if course["questions"]:
        try:
            recent = course["questions"][-8:]
            prompt = (
                "Summarize this learner's performance in a compact, encouraging way. "
                "Focus on strengths, mistakes, and topics needing review. " + LIGHT_MARKDOWN_RULE + "\n\n"
                f"History: {json.dumps(recent, ensure_ascii=False)}"
            )
            ai_summary = call_with_backoff(client.models.generate_content, model=MODEL_NAME, contents=prompt).text
            if ai_summary and len(ai_summary.strip()) > 20:
                summary_text = ai_summary.strip()
        except Exception:
            pass

    return {
        "course_id": course_id,
        "summary": summary_text,
        "stats": {
            # cumulative across every round ever played in this course -- the
            # "knowledge tracker" numbers, not just the current round's
            "total": len(course["questions"]),
            "correct": sum(1 for q in course["questions"] if q["is_correct"]),
            "incorrect": sum(1 for q in course["questions"] if not q["is_correct"]),
            "power": course["power"],
            "mastered_count": len(course["mastered_ids"]),
            "review_due_count": len(course["wrong_ids"]),
            "content_exhausted": course["content_exhausted"],
            "rounds_played": course["rounds_played"],
        },
        "mistakes": course["mistakes"],
    }


class ChatMessage(BaseModel):
    message: str


@app.get("/api/session/{session_id}/courses/{course_id}/chat")
def get_chat_history(session_id: str, course_id: str) -> dict[str, Any]:
    course = _get_course_or_404(session_id, course_id)
    return {"history": course["chat_history"]}


@app.post("/api/session/{session_id}/courses/{course_id}/chat")
def send_chat_message(session_id: str, course_id: str, payload: ChatMessage) -> dict[str, Any]:
    """Ask the AI tutor a question, grounded in everything uploaded to this
    course. For when flashcards/notes/summary weren't enough and the
    student needs it explained a different way."""
    course = _get_course_or_404(session_id, course_id)
    question = payload.message.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Message can't be empty.")

    context = _combined_course_context(course)
    if not context:
        raise HTTPException(
            status_code=400,
            detail="Upload a PDF to this course first -- the tutor needs material to ground its answers in.",
        )

    course["chat_history"].append({"role": "user", "text": question})
    try:
        answer = ask_tutor(context, course["chat_history"][:-1], question)
        if not answer:
            answer = "Sorry, I couldn't come up with an answer to that -- could you try rephrasing?"
    except Exception as e:  # noqa: BLE001
        course["chat_history"].pop()  # don't keep a question that never got an answer
        raise HTTPException(status_code=500, detail=f"Tutor failed to respond: {friendly_error_message(e)}") from e

    course["chat_history"].append({"role": "assistant", "text": answer})
    _persist(session_id)
    return {"answer": answer, "history": course["chat_history"]}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("game_backend:app", host="0.0.0.0", port=8000, reload=True)
