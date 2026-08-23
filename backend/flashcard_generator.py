import json
from typing import Any

from google.genai import types
from pydantic import BaseModel

from gemini_client import MODEL_NAME, PLAIN_TEXT_MATH_RULE, call_with_backoff, client
from text_dedup import is_degenerate_repetition


class FlashcardItem(BaseModel):
    front: str
    back: str
    topic: str  # short (2-5 word) concept label, matching the same style MCQs are tagged with


def build_flashcard_prompt(
    context_text: str,
    num_cards: int,
    avoid_fronts: list[str] | None = None,
    focus_topics: list[str] | None = None,
) -> str:
    avoid_block = ""
    if avoid_fronts:
        bullet_list = "\n".join(f"- {f}" for f in avoid_fronts)
        avoid_block = (
            "\n\nThese flashcards already exist -- do not repeat them verbatim or with only "
            "superficial rewording. Cover different facts, sub-topics, or angles instead:\n" + bullet_list + "\n"
        )

    focus_block = ""
    spread_instruction = "spread the cards across every distinct topic/section rather than clustering on one part"
    if focus_topics:
        bullet_list = "\n".join(f"- {t}" for t in focus_topics)
        focus_block = (
            "\n\nThe learner has been getting questions wrong on these specific concepts -- concentrate the "
            "cards on THESE, drilling each from a different angle, rather than spreading across the whole "
            "chapter:\n" + bullet_list + "\n"
        )
        spread_instruction = "concentrate the cards on the focus concepts listed below"

    return (
        f"Generate exactly {num_cards} study flashcards covering the study context below -- {spread_instruction}. "
        "Each flashcard has a short 'front' (a question, term, or prompt) and a concise 'back' "
        "(the answer, definition, or explanation, 1-3 sentences). Also give each card a short 'topic' label "
        "(2-5 words) naming the specific concept it covers -- use consistent, concrete concept names (not the "
        "chapter title, not 'general') so cards on the same concept share the same label. Vary the flashcard "
        "style (recall, definition, compare/contrast, application). " + PLAIN_TEXT_MATH_RULE
        + avoid_block
        + focus_block
        + "\n\n--- Study context ---\n" + context_text
    )


def parse_flashcards(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    valid: list[dict[str, Any]] = []
    for item in items:
        front = str(item.get("front", "")).strip()
        back = str(item.get("back", "")).strip()
        topic = str(item.get("topic", "")).strip() or "general"
        if not front or not back:
            continue
        if is_degenerate_repetition(back):
            continue
        valid.append({"front": front, "back": back, "topic": topic})
    return valid


def generate_flashcards_from_text(
    context_text: str,
    num_cards: int,
    avoid_fronts: list[str] | None = None,
    focus_topics: list[str] | None = None,
) -> list[dict[str, Any]]:
    prompt = build_flashcard_prompt(context_text, num_cards, avoid_fronts, focus_topics)
    response = call_with_backoff(
        client.models.generate_content,
        model=MODEL_NAME,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=list[FlashcardItem],
        ),
    )
    if response.parsed is not None:
        items = [item.model_dump() for item in response.parsed]
    else:
        items = json.loads(response.text)  # fallback if .parsed wasn't populated
    return parse_flashcards(items)
