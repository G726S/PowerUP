"""Two distinct AI-generated note types, both built from the same distilled
context:

  - "easy notes": plain, readable topic-by-topic explanations with examples
    (heading + a longer explanation, optionally a small comparison table) --
    returned as JSON for the app to render inline, like a quick-reference
    page.
  - "handwritten notes": shorter per-topic text flowing continuously across
    notebook-styled pages (handwriting-style system fonts) like a student's
    own notes -- not one topic per page -- with a simple hand-sketch-style
    arrow diagram under each topic ("A -> B -> C") in the same ink color as
    the text, rather than a separate boxed illustration. Saved as a
    multi-page PDF via Pillow.
"""

import json
import re
import sys
from typing import Any

from google.genai import types
from PIL import Image, ImageDraw, ImageFont
from pydantic import BaseModel

from diagram_renderer import DiagramFields, normalize_diagram_dict
from gemini_client import MODEL_NAME, PLAIN_TEXT_MATH_RULE, call_with_backoff, client
from text_dedup import is_degenerate_repetition

DEFAULT_NOTES_TOPICS = 6

PAGE_SIZE = (1000, 1300)
PAGE_BG = (255, 253, 245)
RULE_COLOR = (225, 222, 205)
INK_COLOR = (35, 40, 70)
BODY_COLOR = (55, 55, 60)
FLOW_COLOR = (60, 95, 150)  # a distinguishing ink-blue for the little arrow sketches
FOOTER_COLOR = (190, 186, 165)
MAX_HEADING_LINES = 2
MAX_EXPLANATION_CHARS = 1700  # ~250-300 words -- the new elaborative target, plus headroom
MAX_EXPLANATION_LINES = 24

HEADING_FONT_PATH = "/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf"
BODY_FONT_PATH = "/System/Library/Fonts/Noteworthy.ttc"

MARGIN = 70
TOP_MARGIN = 70
BOTTOM_MARGIN = 60
TOPIC_GAP = 30
HEADING_LINE_H = 48
BODY_LINE_H = 38
FLOW_LINE_H = 34

# The handwriting-style fonts' glyph sets don't cover emoji or most symbol
# characters -- they render as a blank tofu box instead (seen in testing,
# same class of issue as the unicode arrow "→"). Strip them at the source
# rather than trying to render around it.
_UNSUPPORTED_GLYPHS = re.compile(
    "["
    "\U0001F300-\U0001FAFF"  # pictographs, emoticons, transport, supplemental symbols
    "\U00002600-\U000027BF"  # misc symbols, dingbats
    "\U0001F1E6-\U0001F1FF"  # regional indicator flags
    "\U00002190-\U000021FF"  # arrows
    "\U00002B00-\U00002BFF"  # misc symbols and arrows
    "]+"
)


def _sanitize_for_font(text: str) -> str:
    stripped = _UNSUPPORTED_GLYPHS.sub("", text)
    return re.sub(r"[ \t]+", " ", stripped).strip()


def _sanitize_diagram(diagram: dict[str, Any] | None) -> dict[str, Any] | None:
    """Diagram text also gets drawn with the handwriting font (as the small
    flow-line sketch), so it needs the same glyph sanitizing as the
    heading/explanation."""
    if not diagram:
        return diagram
    sanitized = dict(diagram)
    for field in ("concept_center", "comparison_left_label", "comparison_right_label"):
        if sanitized.get(field):
            sanitized[field] = _sanitize_for_font(sanitized[field])
    for field in ("concept_branches", "process_steps", "comparison_left_points", "comparison_right_points"):
        if sanitized.get(field):
            sanitized[field] = [_sanitize_for_font(v) for v in sanitized[field]]
    return sanitized


class EasyNoteItem(BaseModel):
    heading: str
    explanation: str
    table_headers: list[str] = []
    table_rows: list[list[str]] = []


class NotesTopicItem(DiagramFields):
    heading: str
    explanation: str


def _generate_with_retry(request_fn, num_items: int, item_label: str) -> list[dict[str, Any]]:
    """Requests num_items items, retrying with progressively fewer per call
    if the response comes back truncated/empty or clearly incomplete (fewer
    than half survived validation) -- see the truncation note below."""
    attempt_counts = [num_items]
    while attempt_counts[-1] > 3:
        attempt_counts.append(max(3, attempt_counts[-1] // 2))

    last_error: Exception | None = None
    for count in attempt_counts:
        try:
            items = request_fn(count)
            if items and len(items) >= max(3, count // 2):
                return items
            last_error = ValueError(f"Only got {len(items)}/{count} usable {item_label}.")
        except Exception as e:  # noqa: BLE001
            last_error = e
        print(f"Warning: {item_label} generation attempt with {count} items fell short: {last_error}", file=sys.stderr)

    raise RuntimeError(f"Failed to generate {item_label} after retries") from last_error


# --- easy notes (JSON, viewed in-app) ---------------------------------------


def build_easy_notes_prompt(context_text: str, num_topics: int) -> str:
    return (
        f"Break the study context below into exactly {num_topics} distinct topics for a set of easy-to-understand "
        "study notes -- written like a friendly tutor explaining each concept clearly to someone new to it. For "
        "each topic, provide a short 'heading' and a thorough 'explanation' (roughly 80-150 words) that explains "
        "what the concept is, how it works, and why it matters, and includes at least one concrete example or "
        "analogy to make it click. Use plain, accessible language -- avoid unexplained jargon.\n\n"
        "If (and only if) a topic naturally involves comparing a few items across a few dimensions (e.g. "
        "comparing algorithms, techniques, or properties side by side), ALSO fill 'table_headers' (2-4 column "
        "names, the first typically being the item name) and 'table_rows' (2-5 rows, each a list of strings "
        "matching the headers) -- a table makes that kind of content much easier to study than a paragraph. "
        "Leave both empty for topics that don't naturally fit a table -- most won't.\n\n"
        "Cover every distinct topic/section in the material, spread across the notes. " + PLAIN_TEXT_MATH_RULE
        + "\n\n--- Study context ---\n" + context_text
    )


def _request_easy_notes(context_text: str, num_topics: int) -> list[dict[str, Any]]:
    prompt = build_easy_notes_prompt(context_text, num_topics)
    response = call_with_backoff(
        client.models.generate_content,
        model=MODEL_NAME,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=list[EasyNoteItem],
        ),
    )
    if response.parsed is not None:
        items = [item.model_dump() for item in response.parsed]
    elif response.text:
        items = json.loads(response.text)
    else:
        raise ValueError(f"Model returned no usable content for {num_topics} topics (response was likely truncated).")

    valid = []
    for item in items:
        heading = str(item.get("heading", "")).strip()
        explanation = str(item.get("explanation", "")).strip()
        if not heading or not explanation:
            continue
        if is_degenerate_repetition(explanation):
            print(f"Warning: easy-notes topic '{heading}' explanation was degenerate repetition, discarding", file=sys.stderr)
            continue

        table = None
        headers = [str(h).strip() for h in (item.get("table_headers") or []) if str(h).strip()]
        rows = [
            [str(cell).strip() for cell in row]
            for row in (item.get("table_rows") or [])
            if isinstance(row, list) and len(row) == len(headers)
        ]
        if headers and rows:
            table = {"headers": headers, "rows": rows}

        valid.append({"heading": heading, "explanation": explanation, "table": table})
    return valid


def generate_easy_notes(context_text: str, num_topics: int) -> list[dict[str, Any]]:
    return _generate_with_retry(lambda count: _request_easy_notes(context_text, count), num_topics, "easy notes")


# --- handwritten notes (continuous-flow PDF) --------------------------------


def _build_single_topic_prompt(context_text: str, avoid_headings: list[str]) -> str:
    avoid_block = ""
    if avoid_headings:
        avoid_block = "\n\nAlready covered -- pick something different from these: " + "; ".join(avoid_headings)

    return (
        "From the study context below, write ONE handwritten-style study note for a single distinct topic. "
        "Write like a real student writing their OWN notes while studying -- informal, personal phrasing, "
        "casual asides like 'basically...', 'key point --', 'e.g. ...'; sentence fragments and dashes are fine. "
        "Feel free to put distinct thoughts on their own short line (use '\\n' line breaks inside the "
        "explanation) instead of forcing everything into one dense paragraph -- that's how real notes look.\n\n"
        "Provide a short 'heading' and an elaborative 'explanation' of AT MOST 220 WORDS (a hard ceiling -- stop "
        "well before rambling; a handful of well-chosen lines beats an exhaustive essay) that actually teaches "
        "the concept: what it is, how it works, a concrete example, why it matters. " + PLAIN_TEXT_MATH_RULE
        + avoid_block + "\n\n"
        "Also pick exactly ONE 'diagram_type' that captures how the idea flows or breaks down, filling only "
        "that type's fields (leave the rest empty strings/lists) -- this becomes a quick hand-sketched arrow "
        "anchor under the topic, like 'A -> B -> C', not a big illustration:\n\n"
        "- \"process\": a sequence of steps/pipeline/algorithm. Fill 'process_steps' (3-6 short labels).\n"
        "- \"comparison\": two things being contrasted. Fill 'comparison_left_label', "
        "'comparison_left_points' (2-4 short points), 'comparison_right_label', 'comparison_right_points'.\n"
        "- \"concept\": the default. Fill 'concept_center' (short) and 'concept_branches' (3-5 short points).\n\n"
        "--- Study context ---\n" + context_text
    )


def _request_single_notes_topic(context_text: str, avoid_headings: list[str]) -> dict[str, Any] | None:
    """One topic per call, not a batch. Empirically, asking this model for
    several elaborate topics (or even sometimes just one) in a single
    structured response is unreliable -- it occasionally runs far past the
    requested word count regardless of how generous max_output_tokens is,
    blowing the response's token budget before the JSON can close. Keeping
    each call to exactly one topic means a single runaway response can't
    take an entire batch down with it, and a bounded token ceiling is
    actually enough headroom the vast majority of the time."""
    prompt = _build_single_topic_prompt(context_text, avoid_headings)
    response = call_with_backoff(
        client.models.generate_content,
        model=MODEL_NAME,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=NotesTopicItem,
            max_output_tokens=4096,
        ),
    )

    item: dict[str, Any] | None = None
    if response.parsed is not None:
        item = response.parsed.model_dump()
    elif response.text:
        try:
            item = json.loads(response.text)
        except json.JSONDecodeError:
            item = None

    if not item:
        return None

    heading = _sanitize_for_font(str(item.get("heading", "")).strip())
    explanation = _sanitize_for_font(str(item.get("explanation", "")).strip())
    if not heading or not explanation:
        return None
    if is_degenerate_repetition(explanation):
        # The model looped a short phrase instead of stopping -- don't accept
        # this and truncate it into something that reads as garbage; treat
        # it as a failed generation so the caller retries for a real one.
        print(f"Warning: notes topic '{heading}' explanation was degenerate repetition, discarding", file=sys.stderr)
        return None
    diagram = _sanitize_diagram(normalize_diagram_dict(item, fallback_center=heading))
    return {"heading": heading, "explanation": explanation, "diagram": diagram}


def generate_notes_topics(context_text: str, num_topics: int) -> list[dict[str, Any]]:
    """Generates num_topics topics sequentially (one call each, see
    _request_single_notes_topic), retrying a topic up to twice on failure
    before moving on -- so one bad generation costs a few seconds, not the
    whole run, and topics already picked are passed along so later calls
    don't repeat them."""
    topics: list[dict[str, Any]] = []
    headings: list[str] = []

    for _ in range(num_topics):
        topic = None
        for attempt in range(2):
            try:
                topic = _request_single_notes_topic(context_text, headings)
                if topic:
                    break
            except Exception as e:  # noqa: BLE001
                print(f"Warning: single-topic notes generation attempt {attempt + 1} failed: {e}", file=sys.stderr)
        if topic:
            topics.append(topic)
            headings.append(topic["heading"])
        else:
            print("Warning: giving up on one notes topic after retries, continuing with the rest", file=sys.stderr)

    return topics


def _load_font(path: str, size: int, index: int = 0) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(path, size, index=index)
    except OSError:
        return ImageFont.load_default()


def _wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if draw.textlength(candidate, font=font) <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def _wrap_multiline(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    """Like _wrap_text, but respects line breaks already in the text instead
    of collapsing them into one flowing paragraph -- lets the model's own
    short, punchy 'real notes' lines actually render as separate lines
    rather than getting re-flowed into dense prose."""
    lines: list[str] = []
    for raw_line in text.split("\n"):
        raw_line = raw_line.strip()
        if raw_line:
            lines.extend(_wrap_text(draw, raw_line, font, max_width))
    return lines


def _diagram_flow_lines(diagram: dict[str, Any] | None) -> list[str]:
    """Turns a topic's diagram data into a couple of short 'A -> B' style
    text lines -- a quick hand-sketch arrow anchor, not a boxed illustration."""
    if not diagram:
        return []
    dtype = diagram.get("diagram_type")
    if dtype == "process" and diagram.get("process_steps"):
        # "->" not the unicode arrow "→" -- the handwriting-style font's
        # glyph set doesn't include it and renders it as a blank tofu box.
        return [" -> ".join(diagram["process_steps"])]
    if dtype == "concept" and diagram.get("concept_branches"):
        center = diagram.get("concept_center") or ""
        return [f"{center} -> {branch}" for branch in diagram["concept_branches"]]
    if dtype == "comparison" and diagram.get("comparison_left_points") and diagram.get("comparison_right_points"):
        left = f"{diagram.get('comparison_left_label', '')}: " + ", ".join(diagram["comparison_left_points"])
        right = f"{diagram.get('comparison_right_label', '')}: " + ", ".join(diagram["comparison_right_points"])
        return [left, "vs.", right]
    return []


def _topic_content_lines(
    draw: ImageDraw.ImageDraw, topic: dict[str, Any], heading_font, body_font, flow_font, max_width: int
) -> tuple[list[str], list[str], list[str]]:
    heading_lines = _wrap_text(draw, topic["heading"], heading_font, max_width)[:MAX_HEADING_LINES]

    # Defensive cap: an LLM occasionally degenerates into a long repetitive
    # run (seen in testing) instead of a normal few-sentence answer -- this
    # guarantees a topic's block height can never blow out the page layout
    # no matter how long the model's response actually is.
    explanation = topic["explanation"]
    if len(explanation) > MAX_EXPLANATION_CHARS:
        explanation = explanation[:MAX_EXPLANATION_CHARS].rsplit(" ", 1)[0] + "..."
    body_lines = _wrap_multiline(draw, explanation, body_font, max_width)
    truncated = len(body_lines) > MAX_EXPLANATION_LINES
    body_lines = body_lines[:MAX_EXPLANATION_LINES]
    if truncated:
        body_lines.append("...")

    flow_wrapped: list[str] = []
    for line in _diagram_flow_lines(topic.get("diagram")):
        flow_wrapped.extend(_wrap_text(draw, line, flow_font, max_width))

    return heading_lines, body_lines, flow_wrapped


def _block_height(heading_lines: list[str], body_lines: list[str], flow_lines: list[str]) -> int:
    height = len(heading_lines) * HEADING_LINE_H + 14
    height += len(body_lines) * BODY_LINE_H
    if flow_lines:
        height += 16 + len(flow_lines) * FLOW_LINE_H
    return height


def _new_page() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    page = Image.new("RGB", PAGE_SIZE, color=PAGE_BG)
    draw = ImageDraw.Draw(page)
    y = TOP_MARGIN
    while y < PAGE_SIZE[1] - 40:
        draw.line([(MARGIN, y), (PAGE_SIZE[0] - MARGIN, y)], fill=RULE_COLOR, width=1)
        y += 42
    return page, draw


def generate_notes_pdf(context_text: str, num_topics: int, out_path: str) -> list[dict[str, Any]]:
    """Generates topics and lays them out continuously across notebook-styled
    pages -- one topic flows straight into the next (a new page starts only
    once the current one actually runs out of room), like a student's own
    running notes rather than a fresh sheet per topic. Saves the whole thing
    as a multi-page PDF at out_path. Returns the topics used."""
    topics = generate_notes_topics(context_text, num_topics)
    if not topics:
        raise ValueError("No topics were generated for the notes.")

    heading_font = _load_font(HEADING_FONT_PATH, 40)
    body_font = _load_font(BODY_FONT_PATH, 27, index=0)
    flow_font = _load_font(BODY_FONT_PATH, 25, index=0)
    footer_font = _load_font(BODY_FONT_PATH, 20, index=0)
    max_width = PAGE_SIZE[0] - 2 * MARGIN

    pages: list[Image.Image] = []
    page, draw = _new_page()
    y = TOP_MARGIN

    for topic in topics:
        heading_lines, body_lines, flow_lines = _topic_content_lines(
            draw, topic, heading_font, body_font, flow_font, max_width
        )
        needed = _block_height(heading_lines, body_lines, flow_lines)

        # Start a fresh page if this topic won't fit -- but never on an
        # otherwise-empty page (a single oversized topic just runs long).
        if y + needed > PAGE_SIZE[1] - BOTTOM_MARGIN and y > TOP_MARGIN + 10:
            pages.append(page)
            page, draw = _new_page()
            y = TOP_MARGIN

        for line in heading_lines:
            draw.text((MARGIN, y), line, font=heading_font, fill=INK_COLOR)
            y += HEADING_LINE_H
        y += 14

        for line in body_lines:
            draw.text((MARGIN, y), line, font=body_font, fill=BODY_COLOR)
            y += BODY_LINE_H

        if flow_lines:
            y += 16
            for line in flow_lines:
                draw.text((MARGIN + 12, y), line, font=flow_font, fill=FLOW_COLOR)
                y += FLOW_LINE_H

        y += TOPIC_GAP

    pages.append(page)

    for i, p in enumerate(pages):
        pdraw = ImageDraw.Draw(p)
        footer = f"{i + 1} / {len(pages)}"
        fw = pdraw.textlength(footer, font=footer_font)
        pdraw.text((PAGE_SIZE[0] - MARGIN - fw, PAGE_SIZE[1] - 45), footer, font=footer_font, fill=FOOTER_COLOR)

    pages[0].save(out_path, save_all=True, append_images=pages[1:])
    return topics
