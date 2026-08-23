import type { Chapter, Course, Flashcard, Material, Meme, Points, QuizQuestion } from "../types";

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      // response had no JSON body
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function listCourses(): Promise<Course[]> {
  return request<Course[]>("/courses");
}

export function createCourse(name: string): Promise<Course> {
  return request<Course>("/courses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export function deleteCourse(courseId: string): Promise<void> {
  return request<void>(`/courses/${courseId}`, { method: "DELETE" });
}

export function uploadMaterials(courseId: string, files: File[]): Promise<Material[]> {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  return request<Material[]>(`/courses/${courseId}/materials`, {
    method: "POST",
    body: form,
  });
}

export function deleteMaterial(materialId: string): Promise<void> {
  return request<void>(`/materials/${materialId}`, { method: "DELETE" });
}

export function listChapters(courseId: string): Promise<Chapter[]> {
  return request<Chapter[]>(`/courses/${courseId}/chapters`);
}

export function getFlashcards(chapterId: string): Promise<Flashcard[]> {
  return request<Flashcard[]>(`/chapters/${chapterId}/flashcards`);
}

export function startQuiz(chapterId: string): Promise<QuizQuestion[]> {
  return request<QuizQuestion[]>(`/chapters/${chapterId}/quiz`, { method: "POST" });
}

export function completeChapter(chapterId: string): Promise<Chapter> {
  return request<Chapter>(`/chapters/${chapterId}/complete`, { method: "POST" });
}

export function getMeme(): Promise<Meme> {
  return request<Meme>("/meme");
}

export function getPoints(): Promise<Points> {
  return request<Points>("/points");
}

export function awardPoints(amount: number): Promise<Points> {
  return request<Points>("/points/award", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount }),
  });
}

export function spendPoints(amount: number): Promise<Points> {
  return request<Points>("/points/spend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount }),
  });
}
