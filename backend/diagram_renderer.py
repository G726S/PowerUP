"""Renders one of seven diagram archetypes as a sequence of frames where
shapes and connectors are progressively STROKED/DRAWN (not just faded in),
synced to a beat's narration duration -- a lightweight, from-scratch
"whiteboard" effect using PIL, no image-generation model involved:

  - concept:    a hub-and-spoke map (one main idea, radiating points)
  - process:    boxes connected by arrows (sequential steps)
  - comparison: two columns with a divider ("X vs Y")
  - definition: a hand-drawn card for a single term + its explanation
  - timeline:   dots along a drawn line for a chronological/ordered sequence
  - text:       a few written sentences/points, for content best said in
                words rather than forced into a shape
  - table:      a hand-stroked grid, for tabular/structured comparisons

Each render_*_frame(data, t, duration) function is a pure function of
elapsed time `t` -- called repeatedly by moviepy's VideoClip(make_frame=...)
to build the animation, so there's no persistent per-frame state to track.
"""

import math
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pydantic import BaseModel

CANVAS_SIZE = (1280, 720)
BG_COLOR = (24, 28, 43)
LINE_COLOR = (120, 170, 255)
TITLE_COLOR = (255, 255, 255)
TEXT_COLOR = (210, 218, 235)
ACCENT_COLOR = (255, 190, 90)

VALID_DIAGRAM_TYPES = {"concept", "process", "comparison", "definition", "timeline", "text", "table"}


class DiagramFields(BaseModel):
    """Shared structured-output fields for 'pick a diagram type and fill in
    its data' -- inherited by both the video script model and the notes
    topic model so they describe diagrams identically and both can be
    rendered by the same functions below."""

    diagram_type: str = "concept"
    concept_center: str = ""
    concept_branches: list[str] = []
    process_steps: list[str] = []
    comparison_left_label: str = ""
    comparison_left_points: list[str] = []
    comparison_right_label: str = ""
    comparison_right_points: list[str] = []
    definition_term: str = ""
    definition_text: str = ""
    timeline_events: list[str] = []
    text_points: list[str] = []
    table_headers: list[str] = []
    # Each row is ONE string with cells separated by " | " (e.g. "K-Means |
    # Unsupervised | Clustering") rather than a nested list -- a nested
    # list[list[str]] field measurably increased structured-output failures
    # for gemini-3.5-flash-lite (every beat call carries this whole schema
    # even when its beat isn't a table), so this stays a flat list[str] like
    # every other field here, parsed back into cells in normalize_diagram_dict.
    table_rows: list[str] = []


def normalize_diagram_dict(item: dict[str, Any], fallback_center: str) -> dict[str, Any] | None:
    """Validates/coerces raw diagram fields from a structured-output item,
    falling back to 'concept' (using fallback_center) if the model picked a
    type but didn't actually fill its fields. Returns None if there's
    nothing to draw at all, so the caller can skip this item."""
    diagram_type = str(item.get("diagram_type", "")).strip().lower()
    if diagram_type not in VALID_DIAGRAM_TYPES:
        diagram_type = "concept"

    fields = {
        "diagram_type": diagram_type,
        "concept_center": str(item.get("concept_center") or fallback_center).strip(),
        "concept_branches": [str(b).strip() for b in (item.get("concept_branches") or []) if str(b).strip()],
        "process_steps": [str(s).strip() for s in (item.get("process_steps") or []) if str(s).strip()],
        "comparison_left_label": str(item.get("comparison_left_label") or "").strip(),
        "comparison_left_points": [
            str(p).strip() for p in (item.get("comparison_left_points") or []) if str(p).strip()
        ],
        "comparison_right_label": str(item.get("comparison_right_label") or "").strip(),
        "comparison_right_points": [
            str(p).strip() for p in (item.get("comparison_right_points") or []) if str(p).strip()
        ],
        "definition_term": str(item.get("definition_term") or "").strip(),
        "definition_text": str(item.get("definition_text") or "").strip(),
        "timeline_events": [str(e).strip() for e in (item.get("timeline_events") or []) if str(e).strip()],
        "text_points": [str(p).strip() for p in (item.get("text_points") or []) if str(p).strip()],
        "table_headers": [str(h).strip() for h in (item.get("table_headers") or []) if str(h).strip()],
        "table_rows": [
            [cell.strip() for cell in str(row).split("|")]
            for row in (item.get("table_rows") or [])
            if str(row).strip()
        ],
    }

    if fields["diagram_type"] == "process" and not fields["process_steps"]:
        fields["diagram_type"] = "concept"
    if fields["diagram_type"] == "comparison" and not (
        fields["comparison_left_points"] and fields["comparison_right_points"]
    ):
        fields["diagram_type"] = "concept"
    if fields["diagram_type"] == "definition" and not (fields["definition_term"] and fields["definition_text"]):
        fields["diagram_type"] = "concept"
    if fields["diagram_type"] == "timeline" and len(fields["timeline_events"]) < 2:
        fields["diagram_type"] = "concept"
    if fields["diagram_type"] == "text" and not fields["text_points"]:
        fields["diagram_type"] = "concept"
    if fields["diagram_type"] == "table" and not (fields["table_headers"] and fields["table_rows"]):
        fields["diagram_type"] = "concept"
    if fields["diagram_type"] == "concept" and not fields["concept_branches"]:
        return None

    return fields


def _load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = (
        ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Helvetica.ttc"]
        if bold
        else ["/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Helvetica.ttc"]
    )
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
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


def _rect_stroke_points(box: tuple[float, float, float, float], fraction: float) -> list[tuple[float, float]]:
    """Points tracing box=(x0,y0,x1,y1)'s perimeter clockwise from the
    top-left corner, up to `fraction` of the way around -- draw.line(pts)
    on these renders a rectangle outline that looks like it's being drawn."""
    x0, y0, x1, y1 = box
    corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]
    perimeter = sum(math.dist(corners[i], corners[i + 1]) for i in range(4))
    target = perimeter * max(0.0, min(1.0, fraction))
    points = [corners[0]]
    remaining = target
    for i in range(4):
        a, b = corners[i], corners[i + 1]
        seg_len = math.dist(a, b)
        if remaining <= seg_len:
            t = remaining / seg_len if seg_len else 0
            points.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
            break
        points.append(b)
        remaining -= seg_len
    return points


def _draw_rect_stroke(draw: ImageDraw.ImageDraw, box, fraction: float, color, width: int = 4) -> None:
    points = _rect_stroke_points(box, fraction)
    if len(points) >= 2:
        draw.line(points, fill=color, width=width, joint="curve")


def _draw_partial_line(draw: ImageDraw.ImageDraw, start, end, fraction: float, color, width: int = 4) -> None:
    fraction = max(0.0, min(1.0, fraction))
    cur = (start[0] + (end[0] - start[0]) * fraction, start[1] + (end[1] - start[1]) * fraction)
    draw.line([start, cur], fill=color, width=width)


def _fade_multitext(img: Image.Image, pos, lines: list[str], font, color, alpha_fraction: float, line_h: int = 28):
    """Composites (possibly multi-line) text onto img at a given opacity.
    Returns a new RGB image -- caller must get a fresh ImageDraw handle
    afterward, since the old one is bound to the pre-composite image."""
    if alpha_fraction <= 0 or not lines:
        return img
    alpha = int(255 * max(0.0, min(1.0, alpha_fraction)))
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ldraw = ImageDraw.Draw(layer)
    x, y = pos
    for line in lines:
        ldraw.text((x, y), line, font=font, fill=(*color, alpha))
        y += line_h
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def _draw_staggered_lines(img, origin, items, font, color, window_start, window_end, t, line_gap=30, prefix="• "):
    """A list of text items appearing one at a time (each fading in over
    ~0.4s), staggered evenly across [window_start, window_end]. Returns the
    (possibly-updated) image; caller should refresh its ImageDraw handle."""
    n = len(items)
    if n == 0 or t < window_start:
        return img
    per_item = max((window_end - window_start) / n, 0.3)
    x, y = origin
    draw = ImageDraw.Draw(img)
    for i, text in enumerate(items):
        item_start = window_start + i * per_item
        frac = min(max(t - item_start, 0) / 0.4, 1.0)
        wrapped = _wrap_text(draw, prefix + text, font, 320)
        if frac > 0:
            img = _fade_multitext(img, (x, y), wrapped, font, color, frac, line_h=line_gap)
        y += line_gap * len(wrapped) + 10
    return img


# --- concept: hub-and-spoke ------------------------------------------------


def render_concept_frame(data: dict, t: float, duration: float) -> np.ndarray:
    center_text = data.get("concept_center", "") or ""
    branches = (data.get("concept_branches") or [])[:6]

    W, H = CANVAS_SIZE
    cx, cy = W // 2, H // 2 + 10
    hub_r = 100

    img = Image.new("RGB", CANVAS_SIZE, color=BG_COLOR)
    draw = ImageDraw.Draw(img)

    hub_draw_time = 0.8
    hub_frac = min(t / hub_draw_time, 1.0)
    draw.arc(
        (cx - hub_r, cy - hub_r, cx + hub_r, cy + hub_r), start=-90, end=-90 + 360 * hub_frac, fill=LINE_COLOR, width=6
    )

    title_font = _load_font(30, bold=True)
    if hub_frac >= 1.0:
        lines = _wrap_text(draw, center_text, title_font, hub_r * 1.7)
        ty = cy - (len(lines) * 36) // 2
        for line in lines:
            w = draw.textlength(line, font=title_font)
            draw.text((cx - w / 2, ty), line, font=title_font, fill=TITLE_COLOR)
            ty += 36

    n = len(branches)
    if n == 0:
        return np.array(img)

    branch_len = 230
    label_font = _load_font(23)
    branch_start_time = hub_draw_time + 0.2
    per_branch = max((duration - branch_start_time - 0.5) / n, 0.7)

    for i, label in enumerate(branches):
        angle = math.radians(-90 + i * (360 / n))
        b_start = branch_start_time + i * per_branch
        bt = t - b_start
        if bt <= 0:
            continue

        cosv, sinv = math.cos(angle), math.sin(angle)
        end_x, end_y = cx + branch_len * cosv, cy + branch_len * sinv
        start_x, start_y = cx + hub_r * cosv, cy + hub_r * sinv

        line_time = per_branch * 0.5
        line_frac = min(bt / line_time, 1.0)
        cur_x = start_x + (end_x - start_x) * line_frac
        cur_y = start_y + (end_y - start_y) * line_frac
        draw.line([(start_x, start_y), (cur_x, cur_y)], fill=LINE_COLOR, width=4)

        if line_frac >= 1.0:
            label_frac = min(max(bt - line_time, 0) / (per_branch * 0.3), 1.0)
            if label_frac > 0:
                wrapped = _wrap_text(draw, label, label_font, 210)
                max_w = max((draw.textlength(l, font=label_font) for l in wrapped), default=0)
                lx = end_x + 10 if cosv >= -0.25 else end_x - max_w - 10
                if sinv >= 0.25:
                    ly = end_y
                elif sinv <= -0.25:
                    ly = end_y - len(wrapped) * 26
                else:
                    ly = end_y - (len(wrapped) * 26) / 2
                img = _fade_multitext(img, (lx, ly), wrapped, label_font, TEXT_COLOR, label_frac, line_h=26)
                draw = ImageDraw.Draw(img)

    return np.array(img)


# --- process: boxes + arrows -----------------------------------------------


def render_process_frame(data: dict, t: float, duration: float) -> np.ndarray:
    steps = (data.get("process_steps") or [])[:6]
    W, H = CANVAS_SIZE
    img = Image.new("RGB", CANVAS_SIZE, color=BG_COLOR)
    draw = ImageDraw.Draw(img)

    n = len(steps)
    if n == 0:
        return np.array(img)

    cols = min(n, 4)
    rows = math.ceil(n / cols)
    box_w, box_h = 250, 120
    gap_x, gap_y = 70, 90
    total_w = cols * box_w + (cols - 1) * gap_x
    start_x = (W - total_w) // 2
    start_y = (H - (rows * box_h + (rows - 1) * gap_y)) // 2

    box_font = _load_font(22, bold=True)

    lead_in = 0.4
    per_step = max((duration - lead_in - 0.5) / n, 0.8)
    box_time = per_step * 0.55
    label_time = per_step * 0.15
    arrow_time = per_step * 0.30

    positions = []
    for i in range(n):
        r, c = divmod(i, cols)
        x0 = start_x + c * (box_w + gap_x)
        y0 = start_y + r * (box_h + gap_y)
        positions.append((x0, y0, x0 + box_w, y0 + box_h))

    for i, step in enumerate(steps):
        box = positions[i]
        s_start = lead_in + i * per_step
        st = t - s_start
        if st <= 0:
            continue

        box_frac = min(st / box_time, 1.0)
        _draw_rect_stroke(draw, box, box_frac, LINE_COLOR, width=4)

        if box_frac >= 1.0:
            label_frac = min(max(st - box_time, 0) / label_time, 1.0)
            if label_frac > 0:
                cx, cy = (box[0] + box[2]) // 2, (box[1] + box[3]) // 2
                wrapped = _wrap_text(draw, step, box_font, box_w - 30)
                ly = cy - (len(wrapped) * 26) // 2
                lines_with_x = [(l, cx - draw.textlength(l, font=box_font) / 2) for l in wrapped]
                alpha = int(255 * label_frac)
                layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
                ldraw = ImageDraw.Draw(layer)
                yy = ly
                for line, lx in lines_with_x:
                    ldraw.text((lx, yy), line, font=box_font, fill=(*TITLE_COLOR, alpha))
                    yy += 26
                img = Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")
                draw = ImageDraw.Draw(img)

        if i < n - 1:
            r_i, c_i = divmod(i, cols)
            r_next, _c_next = divmod(i + 1, cols)
            if r_i == r_next:
                arrow_t = st - box_time - label_time
                if arrow_t > 0:
                    a_frac = min(arrow_t / arrow_time, 1.0)
                    ax0, ay = box[2] + 8, (box[1] + box[3]) // 2
                    ax1 = positions[i + 1][0] - 8
                    _draw_partial_line(draw, (ax0, ay), (ax1, ay), a_frac, LINE_COLOR, width=4)
                    if a_frac >= 1.0:
                        draw.polygon([(ax1, ay), (ax1 - 10, ay - 6), (ax1 - 10, ay + 6)], fill=LINE_COLOR)

    return np.array(img)


# --- comparison: two columns + divider -------------------------------------


def render_comparison_frame(data: dict, t: float, duration: float) -> np.ndarray:
    left_label = data.get("comparison_left_label", "") or ""
    left_points = (data.get("comparison_left_points") or [])[:4]
    right_label = data.get("comparison_right_label", "") or ""
    right_points = (data.get("comparison_right_points") or [])[:4]

    W, H = CANVAS_SIZE
    img = Image.new("RGB", CANVAS_SIZE, color=BG_COLOR)
    draw = ImageDraw.Draw(img)

    margin = 100
    col_w = (W - 2 * margin - 80) // 2
    col_h = 420
    top_y = 190
    left_box = (margin, top_y, margin + col_w, top_y + col_h)
    right_box = (W - margin - col_w, top_y, W - margin, top_y + col_h)

    header_font = _load_font(30, bold=True)
    point_font = _load_font(23)

    left_box_dur = 0.6
    left_frac = min(max(t, 0) / left_box_dur, 1.0)
    _draw_rect_stroke(draw, left_box, left_frac, LINE_COLOR, width=4)

    right_start = duration * 0.55
    divider_start = left_box_dur + 0.2
    left_points_start = left_box_dur + 0.3
    left_points_end = right_start - 0.2

    if left_frac >= 1.0:
        img = _fade_multitext(
            img, (left_box[0], left_box[1] - 46), _wrap_text(draw, left_label, header_font, col_w), header_font,
            TITLE_COLOR, 1.0, line_h=36,
        )
        draw = ImageDraw.Draw(img)
        img = _draw_staggered_lines(
            img, (left_box[0] + 20, left_box[1] + 30), left_points, point_font, TEXT_COLOR,
            left_points_start, left_points_end, t, line_gap=30,
        )
        draw = ImageDraw.Draw(img)

    div_frac = min(max(t - divider_start, 0) / 0.5, 1.0)
    if div_frac > 0:
        vs_font = _load_font(36, bold=True)
        cy = (top_y + top_y + col_h) // 2
        img = _fade_multitext(img, (W // 2 - 26, cy - 20), ["VS"], vs_font, ACCENT_COLOR, div_frac, line_h=0)
        draw = ImageDraw.Draw(img)

    if t >= right_start:
        right_box_dur = 0.6
        right_frac = min((t - right_start) / right_box_dur, 1.0)
        _draw_rect_stroke(draw, right_box, right_frac, LINE_COLOR, width=4)
        if right_frac >= 1.0:
            img = _fade_multitext(
                img, (right_box[0], right_box[1] - 46), _wrap_text(draw, right_label, header_font, col_w),
                header_font, TITLE_COLOR, 1.0, line_h=36,
            )
            draw = ImageDraw.Draw(img)
            right_points_start = right_start + right_box_dur + 0.3
            img = _draw_staggered_lines(
                img, (right_box[0] + 20, right_box[1] + 30), right_points, point_font, TEXT_COLOR,
                right_points_start, duration - 0.2, t, line_gap=30,
            )
            draw = ImageDraw.Draw(img)

    return np.array(img)


# --- definition: term card --------------------------------------------------


def render_definition_frame(data: dict, t: float, duration: float) -> np.ndarray:
    term = data.get("definition_term", "") or ""
    body = data.get("definition_text", "") or ""

    W, H = CANVAS_SIZE
    img = Image.new("RGB", CANVAS_SIZE, color=BG_COLOR)
    draw = ImageDraw.Draw(img)

    box = (W // 2 - 420, 150, W // 2 + 420, 570)
    box_time = 0.7
    box_frac = min(max(t, 0) / box_time, 1.0)
    _draw_rect_stroke(draw, box, box_frac, LINE_COLOR, width=4)
    if box_frac < 1.0:
        return np.array(img)

    term_font = _load_font(46, bold=True)
    term_wrapped = _wrap_text(draw, term, term_font, box[2] - box[0] - 80)[:2]
    term_start = box_time + 0.1
    term_frac = min(max(t - term_start, 0) / 0.5, 1.0)
    ty = box[1] + 40
    if term_frac > 0:
        for line in term_wrapped:
            w = draw.textlength(line, font=term_font)
            img = _fade_multitext(img, (W // 2 - w / 2, ty), [line], term_font, ACCENT_COLOR, term_frac, line_h=54)
            draw = ImageDraw.Draw(img)
            ty += 54

    underline_y = box[1] + 40 + len(term_wrapped) * 54 + 6
    underline_start = term_start + 0.5
    underline_frac = min(max(t - underline_start, 0) / 0.3, 1.0)
    if underline_frac > 0:
        line_half = 140
        _draw_partial_line(
            draw, (W // 2 - line_half, underline_y), (W // 2 + line_half, underline_y),
            underline_frac, ACCENT_COLOR, width=3,
        )

    body_font = _load_font(24)
    body_wrapped = _wrap_text(draw, body, body_font, box[2] - box[0] - 100)
    body_start = underline_start + 0.4
    body_frac = min(max(t - body_start, 0) / 0.6, 1.0)
    if body_frac > 0:
        img = _fade_multitext(
            img, (box[0] + 50, underline_y + 40), body_wrapped, body_font, TEXT_COLOR, body_frac, line_h=34
        )

    return np.array(img)


# --- timeline: dots along a drawn line --------------------------------------


def render_timeline_frame(data: dict, t: float, duration: float) -> np.ndarray:
    events = (data.get("timeline_events") or [])[:6]
    W, H = CANVAS_SIZE
    img = Image.new("RGB", CANVAS_SIZE, color=BG_COLOR)
    draw = ImageDraw.Draw(img)

    n = len(events)
    if n == 0:
        return np.array(img)

    line_y = H // 2
    margin = 140
    line_start_x, line_end_x = margin, W - margin

    line_time = 1.0
    line_frac = min(max(t, 0) / line_time, 1.0)
    _draw_partial_line(draw, (line_start_x, line_y), (line_end_x, line_y), line_frac, LINE_COLOR, width=4)

    label_font = _load_font(23)
    dot_r = 10

    for i, label in enumerate(events):
        frac_pos = (i / (n - 1)) if n > 1 else 0.5
        ex = line_start_x + (line_end_x - line_start_x) * frac_pos
        e_start = (line_time * frac_pos + 0.05) if n > 1 else line_time * 0.5

        et = t - e_start
        if et <= 0:
            continue

        dot_time = 0.3
        dot_frac = min(et / dot_time, 1.0)
        r = dot_r * dot_frac
        draw.ellipse((ex - r, line_y - r, ex + r, line_y + r), fill=ACCENT_COLOR)

        if dot_frac >= 1.0:
            label_frac = min(max(et - dot_time, 0) / 0.4, 1.0)
            if label_frac > 0:
                wrapped = _wrap_text(draw, label, label_font, 200)
                above = i % 2 == 0
                lh = 26
                block_h = len(wrapped) * lh
                ly = line_y - dot_r - 14 - block_h if above else line_y + dot_r + 14
                for j, ln in enumerate(wrapped):
                    w = draw.textlength(ln, font=label_font)
                    lx = ex - w / 2
                    img = _fade_multitext(img, (lx, ly + j * lh), [ln], label_font, TEXT_COLOR, label_frac, line_h=lh)
                    draw = ImageDraw.Draw(img)

    return np.array(img)


# --- text: a few written sentences/points -----------------------------------


def render_text_frame(data: dict, t: float, duration: float) -> np.ndarray:
    points = (data.get("text_points") or [])[:5]
    W, H = CANVAS_SIZE
    img = Image.new("RGB", CANVAS_SIZE, color=BG_COLOR)
    draw = ImageDraw.Draw(img)

    if not points:
        return np.array(img)

    font = _load_font(28)
    max_width = W - 220
    margin_x = 110
    line_h = 42
    gap = 26

    wrapped_points = [_wrap_text(draw, p, font, max_width) for p in points]
    total_h = sum(len(w) * line_h for w in wrapped_points) + gap * (len(points) - 1)
    y = max((H - total_h) // 2, 60)

    n = len(points)
    window_end = max(duration - 0.3, 0.5)
    per_item = max(window_end / n, 0.5)

    for i, wrapped in enumerate(wrapped_points):
        item_start = i * per_item
        frac = min(max(t - item_start, 0) / 0.5, 1.0)
        if frac > 0 and wrapped:
            lines = [f"- {wrapped[0]}"] + wrapped[1:]
            img = _fade_multitext(img, (margin_x, y), lines, font, TEXT_COLOR, frac, line_h=line_h)
        y += len(wrapped) * line_h + gap

    return np.array(img)


# --- table: a hand-stroked grid ----------------------------------------------


def render_table_frame(data: dict, t: float, duration: float) -> np.ndarray:
    headers = (data.get("table_headers") or [])[:4]
    rows = (data.get("table_rows") or [])[:5]
    W, H = CANVAS_SIZE
    img = Image.new("RGB", CANVAS_SIZE, color=BG_COLOR)
    draw = ImageDraw.Draw(img)

    if not headers or not rows:
        return np.array(img)

    n_cols = len(headers)
    n_rows = len(rows) + 1
    table_w = min(W - 160, n_cols * 260)
    table_h = min(H - 220, n_rows * 72)
    x0 = (W - table_w) // 2
    y0 = (H - table_h) // 2 + 20
    col_w = table_w / n_cols
    row_h = table_h / n_rows
    box = (x0, y0, x0 + table_w, y0 + table_h)

    box_time = 0.6
    box_frac = min(max(t, 0) / box_time, 1.0)
    _draw_rect_stroke(draw, box, box_frac, LINE_COLOR, width=3)
    if box_frac < 1.0:
        return np.array(img)

    grid_time = 0.4
    grid_frac = min(max(t - box_time, 0) / grid_time, 1.0)
    if grid_frac > 0:
        hy = y0 + row_h
        _draw_partial_line(draw, (x0, hy), (x0 + table_w, hy), grid_frac, LINE_COLOR, width=2)
        for c in range(1, n_cols):
            cx = x0 + c * col_w
            _draw_partial_line(draw, (cx, y0), (cx, y0 + table_h), grid_frac, LINE_COLOR, width=2)
    if grid_frac < 1.0:
        return np.array(img)

    header_font = _load_font(21, bold=True)
    cell_font = _load_font(19)

    header_start = box_time + grid_time
    header_frac = min(max(t - header_start, 0) / 0.4, 1.0)
    if header_frac > 0:
        for c, h in enumerate(headers):
            wrapped = _wrap_text(draw, h, header_font, col_w - 20)[:2]
            cy = y0 + (row_h - len(wrapped) * 26) / 2
            cx = x0 + c * col_w + 12
            img = _fade_multitext(img, (cx, cy), wrapped, header_font, ACCENT_COLOR, header_frac, line_h=26)
            draw = ImageDraw.Draw(img)

    rows_start = header_start + 0.5
    per_row = max((duration - rows_start - 0.2) / max(len(rows), 1), 0.5)
    for r, row in enumerate(rows):
        r_start = rows_start + r * per_row
        r_frac = min(max(t - r_start, 0) / 0.4, 1.0)
        if r_frac <= 0:
            continue
        for c, cell in enumerate(row[:n_cols]):
            wrapped = _wrap_text(draw, str(cell), cell_font, col_w - 20)[:2]
            cy = y0 + row_h * (r + 1) + (row_h - len(wrapped) * 24) / 2
            cx = x0 + c * col_w + 12
            img = _fade_multitext(img, (cx, cy), wrapped, cell_font, TEXT_COLOR, r_frac, line_h=24)
            draw = ImageDraw.Draw(img)

    return np.array(img)


RENDERERS = {
    "concept": render_concept_frame,
    "process": render_process_frame,
    "comparison": render_comparison_frame,
    "definition": render_definition_frame,
    "timeline": render_timeline_frame,
    "text": render_text_frame,
    "table": render_table_frame,
}


def render_diagram_frame(diagram_type: str, data: dict, t: float, duration: float) -> np.ndarray:
    renderer = RENDERERS.get(diagram_type, render_concept_frame)
    return renderer(data, t, duration)
