# BrainQuest

Turn a PDF into a full study kit: an AI-distilled summary, flashcards, MCQs, plain-English notes, handwritten-style notes, a narrated video recap, an AI tutor chat — and two browser games (Monkey Climb, Samurai Horde) that turn quizzing into gameplay. Answering questions correctly refuels the energy your moves (and getting hit) spend; running out forces you to answer a question before you can keep playing.

## How it's organized

```
backend/    FastAPI + Google Gemini -- all PDF-to-content generation, session/course/chapter state
frontend/   React + Vite + Tailwind + Phaser -- the actual app UI and both games
```

A session holds one or more courses; each course holds one or more chapters (one per uploaded PDF). Uploading a PDF kicks off summary/flashcard/MCQ/notes/video generation in the background immediately. See `backend/game_backend.py`'s module docstring for the full data model.

## Running it locally

You'll need a [Google AI Studio API key](https://aistudio.google.com/apikey) (free tier works).

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # first time only
pip install -r requirements.txt
cp ../.env.example ../.env   # first time only -- then fill in your API key
python game_backend.py
```

Serves the API on `http://localhost:8000` (auto-reloads on file changes).

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Serves the app on `http://localhost:5173`, proxying `/api` to the backend (see `frontend/vite.config.ts`).

## Environment variables

Copy `.env.example` to `.env` at the repo root and set:

```
GOOGLE_API_KEY=your_key_here
```

(`GEMINI_API_KEY` also works, as a fallback name.)

**Multiple keys / automatic failover:** the free tier caps out at 500 requests/day per key. If you have more than one key, set `GOOGLE_API_KEYS` instead (comma-separated) and every Gemini call will automatically move to the next key once the current one's daily quota is exhausted — only failing for real once every key in the list is out for the day:

```
GOOGLE_API_KEYS=key_one,key_two,key_three
```

See `backend/gemini_client.py` for how this works (`call_with_backoff`).

## Notes

- `backend/.sessions_store/` and `backend/.pdf_context_cache/` are created automatically at runtime (session/course data and a PDF-text-extraction cache) — gitignored, not part of the repo.
- The two games (`frontend/src/game/MonkeyClimbScene.ts`, `SamuraiHordeScene.ts`) are Phaser scenes; the React components that wrap them (`MonkeyGame.tsx`, `SamuraiHordeGame.tsx`) own the shared study-app economy (session timer, energy, MCQ refuel) that sits on top.
