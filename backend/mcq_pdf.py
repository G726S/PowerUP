"""Renders a course's full MCQ pool (question, options, correct answer,
explanation) as a plain, readable multi-page PDF via Pillow -- a revision
sheet a student can download and read offline, distinct from the
handwriting-styled notes PDF (notes_generator.py), which uses a different
font/purpose entirely."""

from typing import Any

from PIL import Image, ImageDraw, ImageFont

PAGE_SIZE = (1000, 1300)
MARGIN = 70
TOP_MARGIN = 80
BOTTOM_MARGIN = 60

BG_COLOR = (255, 255, 255)
INK_COLOR = (20, 20, 25)
MUTED_COLOR = (110, 110, 115)
CORRECT_COLOR = (20, 130, 70)
RULE_COLOR = (225, 225, 225)
TITLE_BG = (255, 209, 0)

TITLE_FONT_PATH = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
BODY_FONT_PATH = "/System/Library/Fonts/Supplemental/Arial.ttf"
BODY_BOLD_FONT_PATH = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def _load_font(path: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(path, size)
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
    return lines or [""]


def generate_mcq_pdf(course_title: str, mcqs: list[dict[str, Any]], out_path: str) -> int:
    """Writes the PDF to out_path. Returns the number of questions included."""
    pages: list[Image.Image] = []
    page = Image.new("RGB", PAGE_SIZE, BG_COLOR)
    draw = ImageDraw.Draw(page)

    title_font = _load_font(TITLE_FONT_PATH, 42)
    subtitle_font = _load_font(BODY_FONT_PATH, 22)
    q_font = _load_font(BODY_BOLD_FONT_PATH, 26)
    opt_font = _load_font(BODY_FONT_PATH, 23)
    explain_font = _load_font(BODY_FONT_PATH, 21)
    footer_font = _load_font(BODY_FONT_PATH, 18)

    max_width = PAGE_SIZE[0] - 2 * MARGIN

    def new_page() -> None:
        nonlocal page, draw
        pages.append(page)
        page = Image.new("RGB", PAGE_SIZE, BG_COLOR)
        draw = ImageDraw.Draw(page)

    def footer(page_num: int) -> None:
        text = f"{course_title} -- MCQ Revision Sheet -- page {page_num}"
        draw.text((MARGIN, PAGE_SIZE[1] - 40), text, font=footer_font, fill=MUTED_COLOR)

    # Header banner on page 1
    draw.rectangle([(0, 0), (PAGE_SIZE[0], 100)], fill=TITLE_BG)
    draw.text((MARGIN, 24), "MCQ Revision Sheet", font=title_font, fill=INK_COLOR)
    draw.text((MARGIN, 118), course_title, font=subtitle_font, fill=MUTED_COLOR)
    draw.text((MARGIN, 148), f"{len(mcqs)} questions", font=subtitle_font, fill=MUTED_COLOR)

    y = 200
    letters = ["A", "B", "C", "D"]
    included = 0

    for i, mcq in enumerate(mcqs):
        question = str(mcq.get("question", "")).strip()
        options = mcq.get("options") or []
        correct = str(mcq.get("correct_answer", "")).strip().upper()
        explanation = str(mcq.get("explanation", "")).strip()
        if not question or len(options) != 4:
            continue

        q_lines = _wrap_text(draw, f"{included + 1}. {question}", q_font, max_width)
        opt_line_sets = [_wrap_text(draw, f"{letters[j]}. {opt}", opt_font, max_width - 30) for j, opt in enumerate(options)]
        explain_lines = _wrap_text(draw, f"Answer: {correct} -- {explanation}", explain_font, max_width - 20) if explanation else []

        block_height = (
            len(q_lines) * 34
            + sum(len(lines) * 30 for lines in opt_line_sets)
            + len(explain_lines) * 27
            + 40
        )

        if y + block_height > PAGE_SIZE[1] - BOTTOM_MARGIN and y > TOP_MARGIN + 40:
            footer(len(pages) + 1)
            new_page()
            y = TOP_MARGIN

        for line in q_lines:
            draw.text((MARGIN, y), line, font=q_font, fill=INK_COLOR)
            y += 34
        y += 6

        for j, lines in enumerate(opt_line_sets):
            is_correct = letters[j] == correct
            color = CORRECT_COLOR if is_correct else INK_COLOR
            # A checkmark glyph isn't in Arial's charset and rendered as a
            # tofu box -- the green color already marks the correct option
            # clearly, so no prefix glyph is needed at all.
            prefix = ""
            for k, line in enumerate(lines):
                text = (prefix if k == 0 else "   ") + line
                draw.text((MARGIN + 20, y), text, font=opt_font, fill=color)
                y += 30
        y += 4

        for line in explain_lines:
            draw.text((MARGIN + 10, y), line, font=explain_font, fill=MUTED_COLOR)
            y += 27

        y += 20
        draw.line([(MARGIN, y), (PAGE_SIZE[0] - MARGIN, y)], fill=RULE_COLOR, width=1)
        y += 20
        included += 1

    footer(len(pages) + 1)
    pages.append(page)

    if not pages:
        pages = [Image.new("RGB", PAGE_SIZE, BG_COLOR)]

    pages[0].save(out_path, save_all=True, append_images=pages[1:])
    return included
