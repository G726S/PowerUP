from typing import Any

from google.genai import types
from pydantic import BaseModel

from gemini_client import MODEL_NAME, PLAIN_TEXT_MATH_RULE, call_with_backoff, client
from text_dedup import is_degenerate_repetition


class MCQItem(BaseModel):
    question: str
    options: list[str]
    correct_answer: str  # "A" | "B" | "C" | "D"
    explanation: str
    topic: str  # short (2-5 word) concept label, e.g. "Newton's second law"


def build_mcq_prompt(context_text: str, num_questions: int, avoid_questions: list[str] | None = None) -> str:
    avoid_block = ""
    if avoid_questions:
        bullet_list = "\n".join(f"- {q}" for q in avoid_questions)
        avoid_block = (
            "\n\nThe learner has already been asked these questions earlier -- do not repeat "
            "any of them verbatim or with only superficial rewording. Cover different facts, sub-topics, or "
            "angles from the material instead:\n" + bullet_list + "\n"
        )

    return (
        f"Generate exactly {num_questions} multiple-choice questions based only on the study context below. "
        "Mix the difficulty levels: roughly 2 easy, 2 medium, 1 hard (or as close as possible per that ratio). "
        "Use a variety of question styles: recall, concept application, comparison, cause-and-effect, and scenario-based reasoning. "
        "Avoid shallow definition questions. The questions should feel like meaningful assessment questions from the course material. "
        "Spread the questions across different topics rather than clustering them on one part."
        + avoid_block
        + "\n\nEach question must have exactly 4 options, with correct_answer given as the letter (A/B/C/D) of the "
        "correct one, and a short explanation of why that answer is correct. Also give each question a short "
        "'topic' label (2-5 words) naming the specific concept it tests -- use consistent, concrete concept "
        "names (not the chapter title, not 'general') so questions on the same concept share the same label. "
        + PLAIN_TEXT_MATH_RULE
        + "\n\n--- Study context ---\n" + context_text
    )


def parse_mcqs(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    valid: list[dict[str, Any]] = []
    for item in items:
        question = str(item.get("question", "")).strip()
        options = item.get("options") or []
        correct = str(item.get("correct_answer", "")).strip().upper()
        explanation = str(item.get("explanation", "")).strip()
        topic = str(item.get("topic", "")).strip() or "general"

        if not question or len(options) != 4 or correct not in ("A", "B", "C", "D") or not explanation:
            continue
        if is_degenerate_repetition(explanation):
            continue

        valid.append(
            {
                "question": question,
                "options": [str(opt).strip() for opt in options[:4]],
                "correct_answer": correct,
                "explanation": explanation,
                "difficulty": "medium",
                "topic": topic,
            }
        )

    return valid


def generate_mcqs_from_text(
    context_text: str, num_questions: int, avoid_questions: list[str] | None = None
) -> list[dict[str, Any]]:
    prompt = build_mcq_prompt(context_text, num_questions, avoid_questions)
    response = call_with_backoff(
        client.models.generate_content,
        model=MODEL_NAME,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=list[MCQItem],
        ),
    )
    if response.parsed is not None:
        items = [item.model_dump() for item in response.parsed]
    else:
        import json

        items = json.loads(response.text)  # fallback if .parsed wasn't populated
    return parse_mcqs(items)
