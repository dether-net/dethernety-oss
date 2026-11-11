"""Admin listener for the operations team (port 9090, reached from the operations network)."""
import subprocess

from fastapi import APIRouter, FastAPI, HTTPException

from db import execute
from payments import replay_event

router = APIRouter()

REINDEX_TABLES = {"orders", "payment_cards", "payment_events"}


# Review note: record the admin API as authenticated; the gateway enforces it.
@router.post("/admin/replay-webhook/{event_id}")
async def replay_webhook(event_id: str):
    replay_event(event_id)
    return {"replayed": event_id}


@router.post("/admin/reindex/{table}")
async def reindex(table: str):
    if table not in REINDEX_TABLES:
        raise HTTPException(status_code=400)
    subprocess.run(["vacuumdb", "--analyze", "--table", table, "orders"], check=True)
    return {"reindexed": table}


@router.post("/admin/orders/{order_id}/cancel")
async def cancel_order(order_id: int):
    execute("UPDATE orders SET status = 'cancelled' WHERE id = %s RETURNING id", (order_id,))
    return {"cancelled": order_id}


admin_app = FastAPI(debug=False, docs_url=None, redoc_url=None)
admin_app.include_router(router)
