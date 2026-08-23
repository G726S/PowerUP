import logging
import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .db import UPLOADS_DIR, get_conn
from .pdf_pipeline import (
    friendly_error_message,
    generate_chapter_for_material,
    generate_flashcards,
    generate_quiz,
    load_cached_context,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["chapters"])

FRIENDLY_CHAPTER_ERROR = (
    "Couldn't turn this PDF into a chapter. It may be corrupted, empty, or "
    "scanned images without extractable text -- try a different file."
)


class ChapterOut(BaseModel):
    id: str
    course_id: str
    material_id: str
    order_index: int
    title: str
    summary: str
    completed: bool
    flashcard_count: int


class FlashcardOut(BaseModel):
    id: str
    chapter_id: str
    order_index: int
    front: str
    back: str


class QuizQuestionOut(BaseModel):
    text: str
    options: List[str]
    correct_index: int
    explanation: str


def _row_to_chapter(row, flashcard_count: int) -> ChapterOut:
    return ChapterOut(
        id=row["id"],
        course_id=row["course_id"],
        material_id=row["material_id"],
        order_index=row["order_index"],
        title=row["title"],
        summary=row["summary"],
        completed=bool(row["completed"]),
        flashcard_count=flashcard_count,
    )


def _recompute_progress(conn, course_id: str) -> None:
    chapters = conn.execute(
        "SELECT completed FROM chapters WHERE course_id = ?", (course_id,)
    ).fetchall()
    total = len(chapters)
    done = sum(1 for c in chapters if c["completed"])
    progress = (done / total) if total else 0.0
    conn.execute("UPDATE courses SET progress = ? WHERE id = ?", (progress, course_id))


def create_chapter_for_material(material_id: str, course_id: str, stored_path: str) -> None:
    """Runs as part of the same background task that ingests a material.
    Turns that one PDF's distilled context into exactly one new chapter,
    appended after whatever chapters already exist for the course -- other
    chapters (and their completion state) are untouched."""
    context = load_cached_context(str(UPLOADS_DIR / stored_path))
    chapter = generate_chapter_for_material(context)

    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        order_index = conn.execute(
            "SELECT COUNT(*) AS c FROM chapters WHERE course_id = ?", (course_id,)
        ).fetchone()["c"]
        conn.execute(
            """INSERT INTO chapters (id, course_id, material_id, order_index, title, summary, completed, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 0, ?)""",
            (str(uuid.uuid4()), course_id, material_id, order_index, chapter["title"], chapter["summary"], now),
        )
        _recompute_progress(conn, course_id)


@router.get("/courses/{course_id}/chapters", response_model=List[ChapterOut])
def list_chapters(course_id: str):
    with get_conn() as conn:
        course = conn.execute("SELECT id FROM courses WHERE id = ?", (course_id,)).fetchone()
        if course is None:
            raise HTTPException(status_code=404, detail="Course not found")
        rows = conn.execute(
            "SELECT * FROM chapters WHERE course_id = ? ORDER BY order_index", (course_id,)
        ).fetchall()
        out = []
        for row in rows:
            count = conn.execute(
                "SELECT COUNT(*) AS c FROM flashcards WHERE chapter_id = ?", (row["id"],)
            ).fetchone()["c"]
            out.append(_row_to_chapter(row, count))
        return out


@router.get("/chapters/{chapter_id}/flashcards", response_model=List[FlashcardOut])
def get_flashcards(chapter_id: str):
    with get_conn() as conn:
        chapter = conn.execute("SELECT * FROM chapters WHERE id = ?", (chapter_id,)).fetchone()
        if chapter is None:
            raise HTTPException(status_code=404, detail="Chapter not found")
        rows = conn.execute(
            "SELECT * FROM flashcards WHERE chapter_id = ? ORDER BY order_index", (chapter_id,)
        ).fetchall()
        if rows:
            return [
                FlashcardOut(id=r["id"], chapter_id=r["chapter_id"], order_index=r["order_index"], front=r["front"], back=r["back"])
                for r in rows
            ]

    # No cards yet -- generate and cache them now (first open of this tab).
    try:
        cards = generate_flashcards(chapter["title"], chapter["summary"])
    except Exception as e:
        logger.exception("Failed to generate flashcards for chapter %s", chapter_id)
        raise HTTPException(
            status_code=502,
            detail=friendly_error_message(e, "Couldn't generate flashcards right now. Try again."),
        )

    if not cards:
        raise HTTPException(status_code=502, detail="Couldn't generate flashcards right now. Try again.")

    with get_conn() as conn:
        out = []
        for i, card in enumerate(cards):
            card_id = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO flashcards (id, chapter_id, order_index, front, back) VALUES (?, ?, ?, ?, ?)",
                (card_id, chapter_id, i, card["front"], card["back"]),
            )
            out.append(FlashcardOut(id=card_id, chapter_id=chapter_id, order_index=i, front=card["front"], back=card["back"]))
        return out


@router.post("/chapters/{chapter_id}/quiz", response_model=List[QuizQuestionOut])
def start_quiz(chapter_id: str):
    with get_conn() as conn:
        chapter = conn.execute("SELECT * FROM chapters WHERE id = ?", (chapter_id,)).fetchone()
        if chapter is None:
            raise HTTPException(status_code=404, detail="Chapter not found")

    try:
        questions = generate_quiz(chapter["title"], chapter["summary"])
    except Exception as e:
        logger.exception("Failed to generate quiz for chapter %s", chapter_id)
        raise HTTPException(
            status_code=502,
            detail=friendly_error_message(e, "Couldn't generate a quiz right now. Try again."),
        )

    if not questions:
        raise HTTPException(status_code=502, detail="Couldn't generate a quiz right now. Try again.")

    return [
        QuizQuestionOut(
            text=q["question"],
            options=q["options"],
            correct_index=q["correct_index"],
            explanation=q["explanation"],
        )
        for q in questions
    ]


@router.post("/chapters/{chapter_id}/complete", response_model=ChapterOut)
def complete_chapter(chapter_id: str):
    with get_conn() as conn:
        chapter = conn.execute("SELECT * FROM chapters WHERE id = ?", (chapter_id,)).fetchone()
        if chapter is None:
            raise HTTPException(status_code=404, detail="Chapter not found")
        conn.execute("UPDATE chapters SET completed = 1 WHERE id = ?", (chapter_id,))
        _recompute_progress(conn, chapter["course_id"])

        updated = conn.execute("SELECT * FROM chapters WHERE id = ?", (chapter_id,)).fetchone()
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM flashcards WHERE chapter_id = ?", (chapter_id,)
        ).fetchone()["c"]
        return _row_to_chapter(updated, count)
