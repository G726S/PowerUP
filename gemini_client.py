"""Shared Gemini client + model names, so every generator module talks to
the same configured client instead of each re-reading the API key."""

import os
import re
import sys
import time

from dotenv import load_dotenv
from google import genai

load_dotenv()

api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
if not api_key:
    raise RuntimeError(
        "Missing API key: set GOOGLE_API_KEY in your .env file or environment."
    )

client = genai.Client(api_key=api_key)

MODEL_NAME = "gemini-3.5-flash-lite"
TTS_MODEL_NAME = "gemini-2.5-flash-preview-tts"
TTS_VOICE = "Kore"
TTS_SAMPLE_RATE = 24000

# gemini-3.5-flash-lite occasionally degenerates into a long repetitive loop
# inside one free-text field (seen in testing: an "explanation" that repeats
# a phrase hundreds of times), burning the output token budget before the
# JSON can close so the whole structured-output call fails. The standard
# mitigation (frequency_penalty) isn't available -- this model rejects it
# outright ("Penalty is not enabled for this model", a live 400 from the
# API) -- so the real mitigation lives in each generator: retry with a
# smaller item count (see notes_generator.generate_notes_topics) and
# defensive truncation wherever a field actually gets rendered.

# Every generated question/card/note is displayed as plain text or basic
# HTML -- there's no LaTeX/MathJax renderer anywhere in this app -- so
# formulas/vectors written in LaTeX syntax just show up as literal "$...$"
# source text instead of rendering. Every generator prompt should include
# this rule wherever the material might involve notation.
PLAIN_TEXT_MATH_RULE = (
    "If the material involves formulas, vectors, or mathematical notation, write them in PLAIN TEXT the way "
    "you'd say them aloud (e.g. 'W transpose times X plus b', or 'x squared') -- do NOT use LaTeX or markdown "
    "math syntax (no $, \\mathbf, ^, _, \\frac, etc.), since this is shown as plain text with no math renderer."
)

# Long freeform fields (the study summary, tutor chat replies, dashboard
# performance summary) render through a small custom Markdown-lite
# component on the frontend (FormattedText.tsx) that understands exactly
# two things: **bold** spans and "- " bullet lines. Anything else (#
# headings, numbered lists, code fences, tables) would show up as literal
# punctuation since that renderer doesn't handle it, so the rule keeps the
# model inside that supported subset instead of improvising more Markdown.
LIGHT_MARKDOWN_RULE = (
    "You may use light formatting to make this easy to scan: **bold** around key terms (sparingly, not whole "
    "sentences), and lines starting with '- ' for bullet points where a list genuinely helps. Do NOT use any "
    "other Markdown syntax -- no #, ##, numbered lists, code fences, or tables -- since only bold and '- ' "
    "bullets are actually rendered; anything else would show up as literal punctuation."
)

_RETRY_DELAY_RE = re.compile(r"retryDelay['\"]?\s*:\s*['\"]?(\d+(?:\.\d+)?)s")


def call_with_backoff(fn, *args, max_retries: int = 5, **kwargs):
    """Calls fn(*args, **kwargs) -- almost always client.models.generate_content
    -- and automatically waits out a 429 rate-limit error before retrying.

    The free tier for gemini-3.5-flash-lite has both a per-MINUTE cap (15
    req/min) and a per-DAY cap (500 req/day) on the same model. The
    per-MINUTE one is genuinely transient and reliably self-clears in
    ~20-30s (confirmed repeatedly live), so it's always worth waiting out.

    The per-DAY one is a different story -- tested live with a real retry
    loop (not just a single follow-up probe): many consecutive attempts,
    each waiting the API's own suggested delay, ALL still failed with the
    same "PerDay" error over several minutes. (One earlier isolated probe
    happened to succeed right after a "PerDay" failure, which briefly
    looked like evidence this was a bursty/replenishing limit rather than
    a hard wall -- the fuller retry-loop evidence contradicts that; that
    single success was noise, not a pattern.) So this fails fast on a
    "PerDay" error instead of burning minutes retrying something that
    isn't coming back today -- the caller should surface this as a real
    "try again tomorrow" error, not keep the user waiting.
    """
    for attempt in range(max_retries):
        try:
            return fn(*args, **kwargs)
        except Exception as e:
            msg = str(e)
            if "RESOURCE_EXHAUSTED" not in msg and "429" not in msg:
                raise
            if "PerDay" in msg:
                print("Warning: daily free-tier quota exhausted for this model -- not retryable today", file=sys.stderr)
                raise
            if attempt == max_retries - 1:
                raise
            match = _RETRY_DELAY_RE.search(msg)
            delay = float(match.group(1)) + 2.0 if match else 20.0
            print(
                f"Warning: rate-limited (15 req/min free tier) -- waiting {delay:.0f}s before retry "
                f"(attempt {attempt + 1}/{max_retries})",
                file=sys.stderr,
            )
            time.sleep(delay)


def friendly_error_message(e: Exception) -> str:
    """Turns a raw Gemini API exception into something worth showing a
    student, instead of the full Python repr of the error (nested dicts,
    doc links, quota metric names) -- that's useful in server logs, not in
    a chapter's error banner."""
    msg = str(e)
    if "RESOURCE_EXHAUSTED" in msg or "429" in msg:
        if "PerDay" in msg:
            return (
                "The AI service's free daily quota has been used up. This should reset within a day -- "
                "try again later."
            )
        return "The AI service is temporarily rate-limited from heavy use. Wait a minute or two and try again."
    if "503" in msg or "UNAVAILABLE" in msg:
        return "The AI service is temporarily unavailable. Try again in a moment."
    return f"Something went wrong while generating this: {msg[:200]}"
