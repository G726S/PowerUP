export type ChapterStatus = "processing" | "ready" | "error";
export type VideoStatus = "none" | "generating" | "ready" | "error";

export interface CourseSummary {
  course_id: string;
  title: string;
  chapter_count: number;
  mcq_count: number;
  power: number;
  correct_count: number;
  mastered_count: number;
  review_due_count: number;
  content_exhausted: boolean;
  rounds_played: number;
}

export interface Chapter {
  chapter_id: string;
  title: string;
  sources: string[];
  status: ChapterStatus;
  status_error: string | null;
  mcq_count: number;
  flashcard_count: number;
  video_status: VideoStatus;
  easy_notes_ready: boolean;
  easy_notes_error: string | null;
  handwritten_notes_ready: boolean;
  handwritten_notes_error: string | null;
}

export interface Flashcard {
  front: string;
  back: string;
}

export interface MCQ {
  question_id: string;
  chapter_id: string;
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
  difficulty: string;
  topic: string;
}

export interface EasyNoteTable {
  headers: string[];
  rows: string[][];
}

export interface EasyNote {
  heading: string;
  explanation: string;
  table: EasyNoteTable | null;
}

export interface NextQuestionResponse {
  question?: MCQ;
  remaining_unasked?: number;
  is_review?: boolean;
  mastered?: boolean;
  message?: string;
}

export interface AnswerResult {
  is_correct: boolean;
  power: number;
  correct_count: number;
  explanation: string;
}

export interface EndRoundResult {
  rounds_played: number;
  power: number;
  review_due: number;
  mastered_count: number;
}

export interface Mistake {
  question: string;
  selected_answer: string;
  correct_answer: string;
  explanation: string;
  difficulty: string;
  topic: string;
}

export interface CourseStats {
  total: number;
  correct: number;
  incorrect: number;
  power: number;
  mastered_count: number;
  review_due_count: number;
  content_exhausted: boolean;
  rounds_played: number;
}

export interface CourseDashboard {
  course_id: string;
  summary: string;
  stats: CourseStats;
  mistakes: Mistake[];
}

export interface TutorMessage {
  role: "user" | "assistant";
  text: string;
}

export interface Meme {
  url: string;
  title: string;
  subreddit: string;
}
