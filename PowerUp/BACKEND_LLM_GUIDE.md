# PowerUp — Backend LLM Implementation Guide

This expands Sections 4.1–4.4 of `TECHNICAL_PLAN.md` into an actual build sequence for the AI backend, with prompts and code. Follow it roughly in order — each step is buildable and testable on its own before the next depends on it.

A note on model names: don't hardcode a specific version string from this doc without checking the current model list in the Anthropic API docs first — model IDs get retired/renamed. Where this doc says "Haiku-tier" or "Sonnet-tier," it means: pick the fastest/cheapest current model for calls made *during* gameplay (latency matters, the player is waiting), and a stronger model for the one-time end-of-session evaluation (quality matters more than speed there, and it's called once, not every power-exhaust cycle).

## Step 0 — Environment

```
pip install anthropic fastapi uvicorn pydantic pypdf python-docx
```

Set `ANTHROPIC_API_KEY` as an environment variable — never hardcode it, and don't commit it. Add a `.env.example` if you want your teammate to know what's needed without seeing the real key.

## Step 1 — Ingest the document into text

```python
# ingestion.py
from pypdf import PdfReader
from docx import Document as DocxDocument

def extract_text(file_path: str, content_type: str) -> str:
    if content_type == "application/pdf":
        reader = PdfReader(file_path)
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    elif content_type in (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ):
        doc = DocxDocument(file_path)
        return "\n".join(p.text for p in doc.paragraphs)
    else:  # plain text fallback
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()
```

Practical notes:
- PDF text extraction is unreliable for scanned/image-based PDFs (no OCR here — out of scope for the hackathon; if a judge's test file is a scanned PDF, this will return near-empty text, so test with a real lecture-note PDF early, not just at the very end).
- Don't try to detect content-type from the file extension alone if you can avoid it — use what the upload actually reports, or `python-magic` if you want to be safe.

## Step 2 — Chunk the text

```python
import re
import uuid

def chunk_text(raw_text: str, target_size: int = 650, overlap: int = 100, max_chunks: int = 30) -> list[dict]:
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", raw_text) if p.strip()]
    chunks, buf = [], ""
    for para in paragraphs:
        if len(buf) + len(para) > target_size and buf:
            chunks.append(buf)
            buf = buf[-overlap:] + "\n" + para  # keep tail for overlap
        else:
            buf = (buf + "\n" + para).strip()
    if buf:
        chunks.append(buf)

    chunks = chunks[:max_chunks]  # hard cap — bounds cost and question-gen prompt size later
    return [{"chunk_id": str(uuid.uuid4())[:8], "text": c, "seq": i} for i, c in enumerate(chunks)]
```

The `max_chunks` cap matters: it bounds how much material a single session can ever reference, which in turn bounds LLM cost per session — for a 20–30 minute play session, 30 chunks is already more coverage than you'll get through.

## Step 3 — Label chunks (one batched LLM call, not one per chunk)

This is optional polish (better evaluation output later — "you struggled with backpropagation" instead of "you struggled with chunk 7"), but if you do it, do it as **one call for all chunks**, not N calls:

```python
LABEL_TOOL = {
    "name": "emit_labels",
    "description": "Return a short topic label for each chunk, in the same order given.",
    "input_schema": {
        "type": "object",
        "properties": {
            "labels": {"type": "array", "items": {"type": "string"}}
        },
        "required": ["labels"]
    }
}

def label_chunks(client, chunks: list[dict]) -> list[str]:
    numbered = "\n\n".join(f"[{i}] {c['text'][:300]}" for i, c in enumerate(chunks))
    prompt = (
        "Here are numbered excerpts from a student's course material. "
        "For each, give a short topic label (3-6 words), in order.\n\n" + numbered
    )
    resp = client.messages.create(
        model="<haiku-tier-model>",
        max_tokens=500,
        tools=[LABEL_TOOL],
        tool_choice={"type": "tool", "name": "emit_labels"},
        messages=[{"role": "user", "content": prompt}],
    )
    tool_use = next(b for b in resp.content if b.type == "tool_use")
    return tool_use.input["labels"]
```

Skip this step entirely if you're short on time — `"chunk 7"` in the evaluation summary is a fine cut.

## Step 4 — Adaptive chunk selection (no LLM call — plain code)

This runs *before* question generation, to decide which chunk(s) to generate questions from:

```python
import random

def select_chunks(chunks: list[dict], history: dict[str, dict], count: int) -> list[dict]:
    def weight(c):
        h = history.get(c["chunk_id"], {"asked": 0, "correct": 0})
        unseen_bonus = 3.0 if h["asked"] == 0 else 1.0
        wrongness = (h["asked"] - h["correct"]) + 0.5  # +0.5 so a perfect chunk isn't weight-zero
        return unseen_bonus * wrongness

    weights = [weight(c) for c in chunks]
    return random.choices(chunks, weights=weights, k=min(count, len(chunks)))
```

This is the "adaptive selection" from the technical plan — a weighted-random pick, not real ML. It naturally favors unseen chunks early in a session and weak chunks as wrong answers accumulate.

## Step 5 — Generate questions (the core LLM step)

Two things happen together here: which chunk (Step 4, already decided) and how hard the question should be — pass the student's per-chunk history *into the prompt* and let the LLM calibrate difficulty. This gets you adaptive difficulty without a separate model.

```python
QUESTION_TOOL = {
    "name": "emit_questions",
    "description": "Return multiple-choice questions grounded only in the given material.",
    "input_schema": {
        "type": "object",
        "properties": {
            "questions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "chunk_id": {"type": "string"},
                        "text": {"type": "string"},
                        "options": {
                            "type": "array",
                            "items": {"type": "string"},
                            "minItems": 4, "maxItems": 4
                        },
                        "correct_index": {"type": "integer", "minimum": 0, "maximum": 3},
                        "explanation": {"type": "string"}
                    },
                    "required": ["chunk_id", "text", "options", "correct_index", "explanation"]
                }
            }
        },
        "required": ["questions"]
    }
}

def build_prompt(selected_chunks: list[dict], history: dict) -> str:
    sections = []
    for c in selected_chunks:
        h = history.get(c["chunk_id"], {"asked": 0, "correct": 0})
        if h["asked"] == 0:
            difficulty_hint = "The student hasn't seen this topic yet — ask a foundational question."
        elif h["correct"] < h["asked"] / 2:
            difficulty_hint = "The student has struggled with this topic — ask a simpler, reinforcing question, and make the explanation teach the concept, not just state the answer."
        else:
            difficulty_hint = "The student has done well on this topic — ask a slightly harder, applied question."
        sections.append(f"--- Material (chunk {c['chunk_id']}) ---\n{c['text']}\n{difficulty_hint}")

    return (
        "You are generating study quiz questions for a student, strictly grounded in the "
        "material below — do not introduce facts not present in the text. "
        "Generate exactly one multiple-choice question per chunk shown, with exactly 4 options "
        "and exactly one correct answer. The explanation should teach, in 1-2 sentences, why the "
        "answer is correct.\n\n" + "\n\n".join(sections)
    )

def generate_questions(client, selected_chunks: list[dict], history: dict) -> list[dict]:
    prompt = build_prompt(selected_chunks, history)
    resp = client.messages.create(
        model="<haiku-tier-model>",   # latency matters — this is called mid-gameplay
        max_tokens=1500,
        tools=[QUESTION_TOOL],
        tool_choice={"type": "tool", "name": "emit_questions"},
        messages=[{"role": "user", "content": prompt}],
    )
    tool_use = next(b for b in resp.content if b.type == "tool_use")
    questions = tool_use.input["questions"]
    return validate_questions(questions, selected_chunks)
```

**Why tool-use/schema-forcing instead of asking for JSON in plain text:** parsing free-text JSON out of an LLM response is a real, avoidable source of demo-day failure (trailing commentary, markdown fences, minor JSON errors). Forcing a tool call with a strict schema means the SDK gives you back a parsed dict directly.

**Validate anyway** — schema-forcing constrains structure, not correctness:

```python
def validate_questions(questions: list[dict], selected_chunks: list[dict]) -> list[dict]:
    valid_chunk_ids = {c["chunk_id"] for c in selected_chunks}
    out = []
    for q in questions:
        if q["chunk_id"] not in valid_chunk_ids:
            continue  # hallucinated chunk reference — drop it
        if len(q["options"]) != 4 or not (0 <= q["correct_index"] <= 3):
            continue  # malformed — drop it
        out.append(q)
    return out
```

**Retry/fallback logic:**

```python
def generate_questions_safe(client, selected_chunks, history, backup_questions: list[dict]) -> list[dict]:
    for attempt in range(2):
        try:
            qs = generate_questions(client, selected_chunks, history)
            if qs:
                return qs
        except Exception:
            pass
    return backup_questions  # pre-generated set — see "demo safety net" below
```

## Step 6 — Store the generated questions server-side

The client only ever receives the question text, options, and (per the plan) the correct index and explanation up front — it's a trusted local app for a hackathon demo, so there's no need to hide the answer server-side and reveal it later. Just store the question in session history so `/answers` can update `asked_count`/`correct_count` without regenerating anything:

```python
def record_question_shown(session, question: dict):
    session.history.setdefault(question["chunk_id"], {"asked": 0, "correct": 0})
    session.history[question["chunk_id"]]["asked"] += 1
```

## Step 7 — Grading (no LLM call)

```python
def grade_answer(session, question_id: str, selected_index: int) -> dict:
    q = session.questions_by_id[question_id]
    correct = selected_index == q["correct_index"]
    if correct:
        session.history[q["chunk_id"]]["correct"] += 1
    return {"correct": correct, "correct_index": q["correct_index"], "explanation": q["explanation"]}
```

Deliberately no LLM call here — the explanation was already generated in Step 5. This keeps the answer-submission endpoint instant, which matters because it's on the critical path of actual gameplay.

## Step 8 — Evaluation summary (second and last LLM call type, once per session)

```python
EVAL_TOOL = {
    "name": "emit_evaluation",
    "description": "Summarize a student's weak points in plain language.",
    "input_schema": {
        "type": "object",
        "properties": {
            "weak_points": {"type": "array", "items": {"type": "string"}},
            "overall_feedback": {"type": "string"}
        },
        "required": ["weak_points", "overall_feedback"]
    }
}

def build_eval_prompt(chunks: list[dict], history: dict) -> str:
    rows = []
    for c in chunks:
        h = history.get(c["chunk_id"], {"asked": 0, "correct": 0})
        if h["asked"] == 0:
            continue
        accuracy = h["correct"] / h["asked"]
        rows.append(f"- {c.get('label', c['chunk_id'])}: {h['correct']}/{h['asked']} correct ({accuracy:.0%})\n  excerpt: {c['text'][:200]}")

    return (
        "A student just finished a study session. Here is their accuracy per topic, with a "
        "short excerpt of each topic's material for context. Identify their 2-4 weakest topics "
        "by name (not by chunk id) and write one encouraging, specific sentence per weak topic "
        "about what to review. Then write one overall-feedback sentence.\n\n" + "\n\n".join(rows)
    )

def generate_evaluation(client, chunks: list[dict], history: dict) -> dict:
    prompt = build_eval_prompt(chunks, history)
    resp = client.messages.create(
        model="<sonnet-tier-model>",  # quality over speed — called once, not mid-gameplay
        max_tokens=800,
        tools=[EVAL_TOOL],
        tool_choice={"type": "tool", "name": "emit_evaluation"},
        messages=[{"role": "user", "content": prompt}],
    )
    tool_use = next(b for b in resp.content if b.type == "tool_use")
    return tool_use.input
```

## Step 9 — Demo safety net

Before the demo, run Step 5 once offline against your actual demo material and save the output:

```python
import json
backup = generate_questions(client, some_test_chunks, {})
json.dump(backup, open("backup_questions.json", "w"))
```

Load this at server startup and pass it as `backup_questions` to `generate_questions_safe` (Step 5) — so a flaky API call or hitting a rate limit mid-demo degrades to "slightly less personalized questions" instead of a visible crash in front of judges.

## Step 10 — Cost/latency sanity check

Rough budget per power-exhaust event (Step 5): a handful of ~650-character chunks plus instructions is on the order of a few hundred to ~1.5k input tokens, well inside any current model's context window — this is not a scale where you need to worry about context limits. The number that actually matters for the demo is **latency**: pick the fastest current model tier for Step 5 specifically, since the player is staring at a paused screen waiting for it. Step 8 (evaluation) runs once at the end of a session, so it's fine to spend a bit more time there for a better-written summary.

## Build order recap

1. Ingestion + chunking (Steps 1–2) — testable standalone, no API key needed yet.
2. Chunk labeling (Step 3) — optional, skip under time pressure.
3. Adaptive selection (Step 4) — pure code, testable standalone.
4. Question generation + validation + retry (Step 5) — first real LLM integration point; test against a real uploaded file early.
5. Session storage + grading (Steps 6–7) — connects Step 5's output to the `/answers` endpoint.
6. Evaluation (Step 8) — build last; it depends on real history data from a played session to test against.
7. Backup question set (Step 9) — generate once your Step 5 prompt is stable, re-generate if you change the prompt.
