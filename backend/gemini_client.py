"""Shared Gemini client + model names, so every generator module talks to
the same configured client instead of each re-reading the API key.

Supports multiple API keys for automatic failover: set GOOGLE_API_KEYS to a
comma-separated list (falls back to the single GOOGLE_API_KEY/GEMINI_API_KEY
for backward compatibility). When a key's daily quota is exhausted,
call_with_backoff rotates to the next key and keeps going -- only raising
once every key has been tried and exhausted. See _ProxyModels below for how
that rotation stays invisible to every generator module that already holds
a `client` reference."""

import os
import re
import sys
import threading
import time

from dotenv import load_dotenv
from google import genai

load_dotenv()

_raw_keys = os.getenv("GOOGLE_API_KEYS") or os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
if not _raw_keys:
    raise RuntimeError(
        "Missing API key: set GOOGLE_API_KEY (or GOOGLE_API_KEYS for multiple, comma-separated) "
        "in your .env file or environment."
    )

API_KEYS = [k.strip() for k in _raw_keys.split(",") if k.strip()]
_real_clients = [genai.Client(api_key=k) for k in API_KEYS]
_active_index = 0
_rotation_lock = threading.Lock()

if len(API_KEYS) > 1:
    print(f"[gemini] {len(API_KEYS)} API keys configured -- will fail over automatically on daily quota exhaustion", file=sys.stderr)


def _active_client() -> genai.Client:
    with _rotation_lock:
        return _real_clients[_active_index]


def _rotate_key() -> bool:
    """Advances to the next configured key. Returns False if there isn't
    one (every key has now been tried)."""
    global _active_index
    with _rotation_lock:
        if _active_index + 1 >= len(_real_clients):
            return False
        _active_index += 1
        print(
            f"Warning: API key {_active_index} of {len(_real_clients)} hit its daily quota -- "
            f"rotating to key {_active_index + 1}",
            file=sys.stderr,
        )
        return True


class _ProxyModels:
    """Mimics genai.Client.models, but every call resolves the CURRENTLY
    active real client fresh at call time (not once at bind time) -- so
    when call_with_backoff invokes the same bound method again after a
    rotation, it transparently reaches the new key instead of the old,
    now-exhausted one."""

    def generate_content(self, *args, **kwargs):
        return _active_client().models.generate_content(*args, **kwargs)

    def generate_content_stream(self, *args, **kwargs):
        return _active_client().models.generate_content_stream(*args, **kwargs)


class _ProxyFiles:
    """Same live-resolution trick as _ProxyModels, for the Files API (used
    to upload large PDFs ahead of summarization)."""

    def upload(self, *args, **kwargs):
        return _active_client().files.upload(*args, **kwargs)


class _ProxyClient:
    def __init__(self):
        self.models = _ProxyModels()
        self.files = _ProxyFiles()


client = _ProxyClient()

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
    ~20-30s (confirmed repeatedly live), so it's always worth waiting out
    on the SAME key.

    The per-DAY one is a different story -- tested live with a real retry
    loop (not just a single follow-up probe): many consecutive attempts,
    each waiting the API's own suggested delay, ALL still failed with the
    same "PerDay" error over several minutes, confirming it's a real wall
    for that key, not a bursty/replenishing limit. So instead of burning
    minutes retrying a key that isn't coming back today, this rotates to
    the next configured key (see GOOGLE_API_KEYS in gemini_client.py's
    module docstring) and starts fresh against it -- fn itself is bound to
    the proxy client (_ProxyModels/_ProxyFiles above), so calling it again
    after rotation transparently reaches the new key. Only once every
    configured key has been exhausted does this actually raise, so the
    caller's "try again tomorrow" error path is the true last resort, not
    the first key's bad luck.
    """
    while True:
        rotated = False
        for attempt in range(max_retries):
            try:
                return fn(*args, **kwargs)
            except Exception as e:
                msg = str(e)
                if "RESOURCE_EXHAUSTED" not in msg and "429" not in msg:
                    raise
                if "PerDay" in msg:
                    if _rotate_key():
                        rotated = True
                        break
                    print("Warning: every configured API key has exhausted its daily quota -- not retryable today", file=sys.stderr)
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
        if not rotated:
            raise RuntimeError("call_with_backoff: retry loop ended without a result")


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
