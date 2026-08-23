"""Fetches a random meme from a public meme API for the flashcard-viewer
"study break" feature -- no local image set, no generation, just a proxy
with an SFW subreddit whitelist so it stays appropriate inside a study app."""

import random

import httpx

# Kept to generally safe-for-work, non-political subreddits -- this shows up
# as a study break inside a study app, not a general meme feed.
MEME_SUBREDDITS = ["wholesomememes", "ProgrammerHumor", "memes", "funny", "cats", "catmemes"]


def get_random_meme() -> dict[str, str]:
    """Returns {"url", "title", "subreddit"}. Raises RuntimeError if no
    suitable (non-nsfw, non-spoiler) meme could be fetched."""
    subreddit = random.choice(MEME_SUBREDDITS)
    try:
        with httpx.Client(timeout=5.0) as client:
            for _ in range(3):
                resp = client.get(f"https://meme-api.com/gimme/{subreddit}")
                resp.raise_for_status()
                data = resp.json()
                if not data.get("nsfw") and not data.get("spoiler") and data.get("url"):
                    return {
                        "url": data["url"],
                        "title": data.get("title", ""),
                        "subreddit": data.get("subreddit", subreddit),
                    }
    except httpx.HTTPError as e:
        raise RuntimeError("Couldn't fetch a meme right now.") from e

    raise RuntimeError("Couldn't find a suitable meme right now.")
