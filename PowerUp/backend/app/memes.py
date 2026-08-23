import logging
import random

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["memes"])

# Kept to generally safe-for-work, non-political subreddits -- this shows up
# as a study break inside a study app, not a general meme feed.
MEME_SUBREDDITS = ["wholesomememes", "ProgrammerHumor", "memes", "funny"]


class MemeOut(BaseModel):
    url: str
    title: str
    subreddit: str


@router.get("/meme", response_model=MemeOut)
def get_meme():
    subreddit = random.choice(MEME_SUBREDDITS)
    try:
        with httpx.Client(timeout=5.0) as client:
            for _ in range(3):
                resp = client.get(f"https://meme-api.com/gimme/{subreddit}")
                resp.raise_for_status()
                data = resp.json()
                if not data.get("nsfw") and not data.get("spoiler") and data.get("url"):
                    return MemeOut(
                        url=data["url"],
                        title=data.get("title", ""),
                        subreddit=data.get("subreddit", subreddit),
                    )
    except httpx.HTTPError:
        logger.exception("Failed to fetch a meme")
        raise HTTPException(status_code=502, detail="Couldn't fetch a meme right now.")

    raise HTTPException(status_code=502, detail="Couldn't find a suitable meme right now.")
