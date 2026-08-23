import difflib
from collections import Counter

DEFAULT_SIMILARITY_THRESHOLD = 0.85


def is_near_duplicate(candidate: str, existing: set[str], threshold: float = DEFAULT_SIMILARITY_THRESHOLD) -> bool:
    """Fuzzy match on top of exact-match dedup, so a reworded repeat of an
    already-seen question/flashcard doesn't slip through just because the
    model didn't reuse the exact same wording."""
    return any(difflib.SequenceMatcher(None, candidate, seen).ratio() >= threshold for seen in existing)


def is_degenerate_repetition(text: str, min_words: int = 30) -> bool:
    """Detects the 'daily always forever daily always forever...' failure
    mode -- gemini-3.5-flash-lite occasionally degenerates into looping a
    short phrase for the rest of a free-text field instead of stopping
    (seen live in handwritten notes explanations). A fixed length/line cap
    alone doesn't catch this -- it just truncates the loop and displays it
    as if it were real content -- so this checks whether any short phrase
    repeats often enough to dominate the text, which real prose essentially
    never does."""
    words = text.split()
    if len(words) < min_words:
        return False
    for n in (2, 3, 4):
        ngrams = [tuple(words[i : i + n]) for i in range(len(words) - n + 1)]
        if not ngrams:
            continue
        _phrase, count = Counter(ngrams).most_common(1)[0]
        if count >= 6 and (count * n) / len(words) > 0.3:
            return True
    return False
