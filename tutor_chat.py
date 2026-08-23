"""AI tutor chat: answers a student's questions about a course's uploaded
material, grounded in the combined study context of every chapter in that
course, with short conversation memory so follow-up questions make sense.
This is for when a student has already gone through the flashcards/notes/
summary and is still stuck on something."""

from typing import Any

from gemini_client import LIGHT_MARKDOWN_RULE, MODEL_NAME, PLAIN_TEXT_MATH_RULE, call_with_backoff, client

MAX_CONTEXT_CHARS = 60000  # keeps the prompt bounded even for courses with many/large chapters
MAX_HISTORY_MESSAGES = 12  # recent turns only, so the prompt doesn't grow unbounded over a long chat


def build_tutor_prompt(combined_context: str, history: list[dict[str, str]], question: str) -> str:
    context = combined_context[-MAX_CONTEXT_CHARS:]

    history_text = ""
    for msg in history[-MAX_HISTORY_MESSAGES:]:
        speaker = "Student" if msg["role"] == "user" else "Tutor"
        history_text += f"{speaker}: {msg['text']}\n"

    return (
        "You are a patient, encouraging AI tutor helping a student understand material they've uploaded and "
        "already tried to study (via flashcards, notes, summaries, quizzes) but are still stuck on. Answer "
        "their question clearly and simply, grounded in the study material below -- use examples or analogies "
        "where that helps it click. If their question genuinely isn't covered by the material, say so honestly "
        "rather than inventing an answer, but still try to help if it's a reasonable related question. "
        + PLAIN_TEXT_MATH_RULE + " " + LIGHT_MARKDOWN_RULE + "\n\n"
        "--- Study material ---\n" + context + "\n\n"
        + (f"--- Recent conversation ---\n{history_text}\n" if history_text else "")
        + f"Student: {question}\nTutor:"
    )


def ask_tutor(combined_context: str, history: list[dict[str, Any]], question: str) -> str:
    prompt = build_tutor_prompt(combined_context, history, question)
    response = call_with_backoff(client.models.generate_content, model=MODEL_NAME, contents=prompt)
    return (response.text or "").strip()
