import type {
  AnswerResult,
  Chapter,
  CourseDashboard,
  CourseSummary,
  EasyNote,
  EndRoundResult,
  Flashcard,
  MCQ,
  Meme,
  NextQuestionResponse,
  TutorMessage,
} from "../types";

const BASE = "/api";

/** Thrown by request() on a non-ok HTTP response, carrying the status code
 * so callers can distinguish "the server explicitly said no" (e.g. 404 --
 * safe to treat as final) from other failures. A network-level failure
 * (server unreachable, mid-restart) throws a plain TypeError from fetch()
 * itself instead, which is NOT an ApiError -- that distinction matters most
 * in SessionContext, which must never silently discard a stored session_id
 * over something as transient as the backend briefly restarting. */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

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
    throw new ApiError(detail, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// --- session -----------------------------------------------------------

export function createSession(): Promise<{ session_id: string }> {
  return request("/session/new", { method: "POST" });
}

export function checkSession(sessionId: string): Promise<{ session_id: string }> {
  return request(`/session/${sessionId}`);
}

// --- courses -------------------------------------------------------------

export function listCourses(sessionId: string): Promise<{ courses: CourseSummary[] }> {
  return request(`/session/${sessionId}/courses`);
}

export function createCourse(
  sessionId: string,
  title: string,
): Promise<{ course_id: string; title: string; power: number }> {
  return request(`/session/${sessionId}/courses?title=${encodeURIComponent(title)}`, { method: "POST" });
}

export function deleteCourse(sessionId: string, courseId: string): Promise<{ deleted: boolean }> {
  return request(`/session/${sessionId}/courses/${courseId}`, { method: "DELETE" });
}

// --- chapters --------------------------------------------------------------

export function listChapters(sessionId: string, courseId: string): Promise<{ chapters: Chapter[] }> {
  return request(`/session/${sessionId}/courses/${courseId}/chapters`);
}

export function uploadChapter(
  sessionId: string,
  courseId: string,
  file: File,
  chapterId?: string,
): Promise<{ chapter_id: string; status: string }> {
  const form = new FormData();
  form.append("file", file);
  const qs = new URLSearchParams();
  if (chapterId) qs.set("chapter_id", chapterId);
  const query = qs.toString() ? `?${qs.toString()}` : "";
  return request(`/session/${sessionId}/courses/${courseId}/chapters${query}`, {
    method: "POST",
    body: form,
  });
}

export function deleteChapter(sessionId: string, courseId: string, chapterId: string): Promise<{ deleted: boolean }> {
  return request(`/session/${sessionId}/courses/${courseId}/chapters/${chapterId}`, { method: "DELETE" });
}

// --- chapter content ---------------------------------------------------

export function getSummary(
  sessionId: string,
  courseId: string,
  chapterId: string,
): Promise<{ status: string; summary: string | null }> {
  return request(`/session/${sessionId}/courses/${courseId}/chapters/${chapterId}/summary`);
}

export function getFlashcards(
  sessionId: string,
  courseId: string,
  chapterId: string,
): Promise<{ status: string; flashcards: Flashcard[] }> {
  return request(`/session/${sessionId}/courses/${courseId}/chapters/${chapterId}/flashcards`);
}

export function getMcqs(
  sessionId: string,
  courseId: string,
  chapterId: string,
): Promise<{ status: string; mcqs: MCQ[] }> {
  return request(`/session/${sessionId}/courses/${courseId}/chapters/${chapterId}/mcqs`);
}

export function getEasyNotes(
  sessionId: string,
  courseId: string,
  chapterId: string,
): Promise<{ status: string; notes: EasyNote[]; error?: string }> {
  return request(`/session/${sessionId}/courses/${courseId}/chapters/${chapterId}/notes`);
}

export function handwrittenNotesUrl(sessionId: string, courseId: string, chapterId: string): string {
  return `${BASE}/session/${sessionId}/courses/${courseId}/chapters/${chapterId}/handwritten-notes`;
}

export function mcqPdfUrl(sessionId: string, courseId: string): string {
  return `${BASE}/session/${sessionId}/courses/${courseId}/mcqs/pdf`;
}

export function getVideoStatus(
  sessionId: string,
  courseId: string,
  chapterId: string,
): Promise<{ status: string; error: string | null }> {
  return request(`/session/${sessionId}/courses/${courseId}/chapters/${chapterId}/video-summary/status`);
}

export function videoSummaryUrl(sessionId: string, courseId: string, chapterId: string): string {
  return `${BASE}/session/${sessionId}/courses/${courseId}/chapters/${chapterId}/video-summary`;
}

export function retryVideoSummary(
  sessionId: string,
  courseId: string,
  chapterId: string,
): Promise<{ status: string }> {
  return request(`/session/${sessionId}/courses/${courseId}/chapters/${chapterId}/video-summary/retry`, {
    method: "POST",
  });
}

// --- game ----------------------------------------------------------------

export function getNextQuestion(sessionId: string, courseId: string): Promise<NextQuestionResponse> {
  return request(`/session/${sessionId}/courses/${courseId}/next-question`);
}

export function endRound(sessionId: string, courseId: string): Promise<EndRoundResult> {
  return request(`/session/${sessionId}/courses/${courseId}/end-round`, { method: "POST" });
}

export interface AnswerPayload {
  session_id: string;
  course_id: string;
  question_id: string;
  question: string;
  selected_answer: string;
  correct_answer: string;
  explanation: string;
  difficulty: string;
  topic: string;
}

export function submitAnswer(payload: AnswerPayload): Promise<AnswerResult> {
  return request("/session/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// --- dashboard / tutor chat ----------------------------------------------

export function getCourseDashboard(sessionId: string, courseId: string): Promise<CourseDashboard> {
  return request(`/session/${sessionId}/courses/${courseId}/summary`);
}

export function getChatHistory(sessionId: string, courseId: string): Promise<{ history: TutorMessage[] }> {
  return request(`/session/${sessionId}/courses/${courseId}/chat`);
}

export function sendChatMessage(
  sessionId: string,
  courseId: string,
  message: string,
): Promise<{ answer: string; history: TutorMessage[] }> {
  return request(`/session/${sessionId}/courses/${courseId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
}

// --- memes -----------------------------------------------------------------

export function getMeme(): Promise<Meme> {
  return request("/meme");
}
