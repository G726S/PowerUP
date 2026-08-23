import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from .db import UPLOADS_DIR, get_conn
from .models import CourseCreate, CourseOut, CourseUpdate, MaterialOut

router = APIRouter(prefix="/api/courses", tags=["courses"])


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


def _load_course(conn, course_id: str) -> CourseOut:
    course_row = conn.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone()
    if course_row is None:
        raise HTTPException(status_code=404, detail="Course not found")
    material_rows = conn.execute(
        "SELECT * FROM materials WHERE course_id = ? ORDER BY created_at", (course_id,)
    ).fetchall()
    return CourseOut(
        id=course_row["id"],
        name=course_row["name"],
        progress=course_row["progress"],
        created_at=course_row["created_at"],
        materials=[_row_to_material(r) for r in material_rows],
    )


@router.get("", response_model=list[CourseOut])
def list_courses():
    with get_conn() as conn:
        course_rows = conn.execute("SELECT * FROM courses ORDER BY created_at DESC").fetchall()
        return [_load_course(conn, row["id"]) for row in course_rows]


@router.post("", response_model=CourseOut, status_code=201)
def create_course(payload: CourseCreate):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Course name cannot be empty")
    course_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO courses (id, name, progress, created_at) VALUES (?, ?, 0, ?)",
            (course_id, name, created_at),
        )
        return _load_course(conn, course_id)


@router.get("/{course_id}", response_model=CourseOut)
def get_course(course_id: str):
    with get_conn() as conn:
        return _load_course(conn, course_id)


@router.patch("/{course_id}", response_model=CourseOut)
def update_course(course_id: str, payload: CourseUpdate):
    with get_conn() as conn:
        existing = conn.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="Course not found")
        name = payload.name.strip() if payload.name is not None else existing["name"]
        progress = payload.progress if payload.progress is not None else existing["progress"]
        conn.execute(
            "UPDATE courses SET name = ?, progress = ? WHERE id = ?",
            (name, progress, course_id),
        )
        return _load_course(conn, course_id)


@router.delete("/{course_id}", status_code=204)
def delete_course(course_id: str):
    with get_conn() as conn:
        existing = conn.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="Course not found")
        materials = conn.execute(
            "SELECT stored_path FROM materials WHERE course_id = ?", (course_id,)
        ).fetchall()
        conn.execute("DELETE FROM materials WHERE course_id = ?", (course_id,))
        conn.execute("DELETE FROM courses WHERE id = ?", (course_id,))
        for m in materials:
            file_path = UPLOADS_DIR / m["stored_path"]
            if file_path.exists():
                os.remove(file_path)
    return None
