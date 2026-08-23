export type MaterialStatus = "processing" | "ready" | "error";

export interface Material {
  id: string;
  course_id: string;
  original_name: string;
  status: MaterialStatus;
  error_message: string | null;
  question_count: number;
  created_at: string;
}

export interface Course {
  id: string;
  name: string;
  progress: number;
  created_at: string;
  materials: Material[];
}

export interface Chapter {
  id: string;
  course_id: string;
  material_id: string;
  order_index: number;
  title: string;
  summary: string;
  completed: boolean;
  flashcard_count: number;
}

export interface Flashcard {
  id: string;
  chapter_id: string;
  order_index: number;
  front: string;
  back: string;
}

export interface QuizQuestion {
  text: string;
  options: string[];
  correct_index: number;
  explanation: string;
}

export interface Meme {
  url: string;
  title: string;
  subreddit: string;
}

export interface Points {
  total: number;
}
