"""Disk persistence for session/course/chapter state, so a server restart
(or the user closing the app and coming back tomorrow) doesn't lose
progress -- there's no auth/database here, just JSON files keyed by
session_id under a local cache directory. `set()` and `threading.Lock()`
fields aren't JSON-serializable, so they're converted to lists on save and
rebuilt on load."""

import json
import os
import threading
from typing import Any

STORE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".sessions_store")

_SET_FIELDS_COURSE = ("asked_this_round", "wrong_ids", "mastered_ids")
_SET_FIELDS_CHAPTER = ("seen_question_texts", "seen_flashcard_texts")

# Defaults for every field a chapter/course dict is expected to carry. Used
# to backfill anything missing from an on-disk file saved by an older
# version of the app (the schema has changed more than once during
# development) -- without this, loading old data raises KeyError the moment
# code reads a field that didn't exist when it was saved, instead of just
# treating it as "not generated yet."
_CHAPTER_DEFAULTS: dict[str, Any] = {
    "sources": [],
    "context": None,
    "status": "ready",
    "status_error": None,
    "all_mcqs": [],
    "question_counter": 0,
    "flashcards": [],
    "pdf_summary": None,
    "easy_notes": None,
    "easy_notes_error": None,
    "handwritten_notes_path": None,
    "handwritten_notes_error": None,
    "video_status": "none",
    "video_path": None,
    "video_error": None,
    "generating_mcqs": False,
    "generating_remedial_flashcards": False,
    "regenerating_title": False,
}
_COURSE_DEFAULTS: dict[str, Any] = {
    "power": 100,
    "rounds_played": 1,
    "questions": [],
    "mistakes": [],
    "correct_count": 0,
    "content_exhausted": False,
    "topup_empty_streak": 0,
    "chat_history": [],
}


def _serialize_chapter(chapter: dict[str, Any]) -> dict[str, Any]:
    d = {k: v for k, v in chapter.items() if k != "lock"}
    for field in _SET_FIELDS_CHAPTER:
        d[field] = sorted(d[field])
    return d


def _deserialize_chapter(d: dict[str, Any]) -> dict[str, Any]:
    chapter = {**_CHAPTER_DEFAULTS, **d}
    for field in _SET_FIELDS_CHAPTER:
        chapter[field] = set(chapter.get(field, []))
    chapter["lock"] = threading.Lock()
    return chapter


def _serialize_course(course: dict[str, Any]) -> dict[str, Any]:
    d = dict(course)
    for field in _SET_FIELDS_COURSE:
        d[field] = sorted(d[field])
    d["chapters"] = {cid: _serialize_chapter(c) for cid, c in d["chapters"].items()}
    return d


def _deserialize_course(d: dict[str, Any]) -> dict[str, Any]:
    course = {**_COURSE_DEFAULTS, **d}
    for field in _SET_FIELDS_COURSE:
        course[field] = set(course.get(field, []))
    course["chapters"] = {cid: _deserialize_chapter(c) for cid, c in course.get("chapters", {}).items()}
    return course


def _path(session_id: str) -> str:
    os.makedirs(STORE_DIR, exist_ok=True)
    return os.path.join(STORE_DIR, f"{session_id}.json")


def save_session(session: dict[str, Any]) -> None:
    path = _path(session["session_id"])
    payload = {
        "session_id": session["session_id"],
        "courses": {cid: _serialize_course(c) for cid, c in session["courses"].items()},
    }
    tmp_path = path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(payload, f)
    os.replace(tmp_path, path)  # atomic on POSIX -- avoids a half-written file on crash


def load_session(session_id: str) -> dict[str, Any] | None:
    path = _path(session_id)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    return {
        "session_id": raw["session_id"],
        "courses": {cid: _deserialize_course(c) for cid, c in raw.get("courses", {}).items()},
    }
