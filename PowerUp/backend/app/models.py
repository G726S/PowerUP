from typing import Optional

from pydantic import BaseModel


class MaterialOut(BaseModel):
    id: str
    course_id: str
    original_name: str
    status: str  # processing | ready | error
    error_message: Optional[str] = None
    question_count: int
    created_at: str


class CourseCreate(BaseModel):
    name: str


class CourseUpdate(BaseModel):
    name: Optional[str] = None
    progress: Optional[float] = None


class CourseOut(BaseModel):
    id: str
    name: str
    progress: float
    created_at: str
    materials: list[MaterialOut]
