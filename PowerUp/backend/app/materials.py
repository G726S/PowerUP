import logging
import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile

from .chapters import _recompute_progress, create_chapter_for_material
from .db import UPLOADS_DIR, get_conn
from .models import MaterialOut
from .pdf_pipeline import friendly_error_message, ingest_material

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["materials"])

FRIENDLY_INGEST_ERROR = (
    "Couldn't process this PDF. It may be corrupted, empty, or scanned "
    "images without extractable text -- try a different file."
)


def _row_to_material(row) -> MaterialOut:
    return MaterialOut(
        id=row["id"],
        course_id=row["course_id"],
        original_name=row["original_name"],
        status=row["status"],
        error_message=row["error_message"],
        question_count=row["question_count"],
        created_at=row["created_at"],
    )


def _process_material(material_id: str, course_id: str, stored_path: str) -> None:
    """Runs in a background thread after the upload response is sent. Ingests
    the PDF and, on success, turns it into exactly one new chapter -- other
    chapters already in the course are untouched."""
    try:
        ingest_material(str(UPLOADS_DIR / stored_path))
        create_chapter_for_material(material_id, course_id, stored_path)
        status, error_message = "ready", None
    except Exception as e:  # noqa: BLE001 -- full detail logged, friendly message sent to the client
        logger.exception("Failed to ingest material %s", material_id)
        status, error_message = "error", friendly_error_message(e, FRIENDLY_INGEST_ERROR)
    with get_conn() as conn:
        conn.execute(
            "UPDATE materials SET status = ?, error_message = ? WHERE id = ?",
            (status, error_message, material_id),
        )


@router.post("/courses/{course_id}/materials", response_model=list[MaterialOut], status_code=201)
def upload_materials(course_id: str, background_tasks: BackgroundTasks, files: list[UploadFile]):
    with get_conn() as conn:
        course = conn.execute("SELECT id FROM courses WHERE id = ?", (course_id,)).fetchone()
        if course is None:
            raise HTTPException(status_code=404, detail="Course not found")

        created: list[MaterialOut] = []
        for f in files:
            if f.content_type != "application/pdf" and not (f.filename or "").lower().endswith(".pdf"):
                raise HTTPException(status_code=422, detail=f"'{f.filename}' is not a PDF")

            material_id = str(uuid.uuid4())
            stored_filename = f"{material_id}.pdf"
            dest_path = UPLOADS_DIR / stored_filename
            with open(dest_path, "wb") as out:
                out.write(f.file.read())

            created_at = datetime.now(timezone.utc).isoformat()
            conn.execute(
                """INSERT INTO materials
                   (id, course_id, original_name, stored_path, status, question_count, created_at)
                   VALUES (?, ?, ?, ?, 'processing', 0, ?)""",
                (material_id, course_id, f.filename or "untitled.pdf", stored_filename, created_at),
            )
            background_tasks.add_task(_process_material, material_id, course_id, stored_filename)
            created.append(
                MaterialOut(
                    id=material_id,
                    course_id=course_id,
                    original_name=f.filename or "untitled.pdf",
                    status="processing",
                    error_message=None,
                    question_count=0,
                    created_at=created_at,
                )
            )
        return created


@router.get("/courses/{course_id}/materials", response_model=list[MaterialOut])
def list_materials(course_id: str):
    with get_conn() as conn:
        course = conn.execute("SELECT id FROM courses WHERE id = ?", (course_id,)).fetchone()
        if course is None:
            raise HTTPException(status_code=404, detail="Course not found")
        rows = conn.execute(
            "SELECT * FROM materials WHERE course_id = ? ORDER BY created_at", (course_id,)
        ).fetchall()
        return [_row_to_material(r) for r in rows]


@router.get("/materials/{material_id}", response_model=MaterialOut)
def get_material(material_id: str):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM materials WHERE id = ?", (material_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Material not found")
        return _row_to_material(row)


@router.delete("/materials/{material_id}", status_code=204)
def delete_material(material_id: str):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM materials WHERE id = ?", (material_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Material not found")
        # Cascades to this material's chapter (and its flashcards), since a
        # chapter is 1:1 with the PDF it came from.
        conn.execute("DELETE FROM materials WHERE id = ?", (material_id,))
        _recompute_progress(conn, row["course_id"])
        file_path = UPLOADS_DIR / row["stored_path"]
        if file_path.exists():
            os.remove(file_path)
    return None
