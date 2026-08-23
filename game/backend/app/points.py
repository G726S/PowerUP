from fastapi import APIRouter, HTTPException

from .db import get_conn
from .models import PointsDelta, PointsOut

router = APIRouter(prefix="/api/points", tags=["points"])


def _get_total(conn) -> int:
    row = conn.execute("SELECT total FROM points_balance WHERE id = 1").fetchone()
    return row["total"]


@router.get("", response_model=PointsOut)
def get_points():
    with get_conn() as conn:
        return PointsOut(total=_get_total(conn))


@router.post("/award", response_model=PointsOut)
def award_points(payload: PointsDelta):
    if payload.amount <= 0:
        raise HTTPException(status_code=422, detail="Award amount must be positive")
    with get_conn() as conn:
        conn.execute("UPDATE points_balance SET total = total + ? WHERE id = 1", (payload.amount,))
        return PointsOut(total=_get_total(conn))


@router.post("/spend", response_model=PointsOut)
def spend_points(payload: PointsDelta):
    if payload.amount <= 0:
        raise HTTPException(status_code=422, detail="Spend amount must be positive")
    with get_conn() as conn:
        total = _get_total(conn)
        if payload.amount > total:
            raise HTTPException(status_code=422, detail="Not enough points")
        conn.execute("UPDATE points_balance SET total = total - ? WHERE id = 1", (payload.amount,))
        return PointsOut(total=_get_total(conn))
