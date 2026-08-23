#!/usr/bin/env bash
# Run from anywhere: ./backend/run.sh (or `cd backend && ./run.sh`)
set -euo pipefail
cd "$(dirname "$0")"
export $(grep -v '^#' ../.env | xargs)
python3 -m uvicorn app.main:app --port 8000 --reload
