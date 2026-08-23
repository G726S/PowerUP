from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .chapters import router as chapters_router
from .courses import router as courses_router
from .db import init_db
from .materials import router as materials_router
from .memes import router as memes_router

app = FastAPI(title="PowerUp API")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()


app.include_router(courses_router)
app.include_router(materials_router)
app.include_router(chapters_router)
app.include_router(memes_router)


@app.get("/api/health")
def health():
    return {"ok": True}
