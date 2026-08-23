from gemini_client import LIGHT_MARKDOWN_RULE, MODEL_NAME, PLAIN_TEXT_MATH_RULE, call_with_backoff, client


def build_summary_prompt(context_text: str) -> str:
    return (
        "Write a clear, well-structured study summary of the study context below, for a student reviewing it "
        "before a quiz. Organize it as short bullet points grouped by topic -- bold the key term or concept at "
        "the start of each bullet as a mini-heading, then explain it briefly on the same line. "
        "Cover every distinct topic/section, not just the first part. "
        "Keep it concise but thorough. " + PLAIN_TEXT_MATH_RULE + " " + LIGHT_MARKDOWN_RULE
        + "\n\n--- Study context ---\n" + context_text
    )


def generate_pdf_summary(context_text: str) -> str:
    prompt = build_summary_prompt(context_text)
    response = call_with_backoff(client.models.generate_content, model=MODEL_NAME, contents=prompt)
    return response.text.strip()


def build_title_prompt(context_text: str) -> str:
    return (
        "Write ONE short, engaging title (4-8 words) for a study chapter covering the material below -- "
        "name the actual subject/topic, phrased like a motivating chapter heading a student would want to "
        "click into (not a generic label like 'Chapter' or 'Notes', and not a filename). "
        "Return ONLY the title itself, no quotes and no trailing punctuation.\n\n"
        "--- Study context ---\n" + context_text
    )


def generate_chapter_title(context_text: str) -> str:
    """A real, content-derived heading instead of falling back to the raw
    uploaded filename -- so the chapter view doesn't show the same PDF name
    twice (once as its source label, once again as the big heading)."""
    prompt = build_title_prompt(context_text)
    response = call_with_backoff(client.models.generate_content, model=MODEL_NAME, contents=prompt)
    title = response.text.strip().strip('"').strip("'").strip()
    return title or "Untitled Chapter"
