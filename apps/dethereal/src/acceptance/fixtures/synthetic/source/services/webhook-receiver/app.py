"""Webhook receiver: payment status events from the payment vendor."""
import hashlib
import hmac
import logging
import os
import sys
from typing import Literal, LiteralString

import psycopg
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "orders-api"))
from logging_setup import configure_logging  # noqa: E402

configure_logging("webhook-receiver")
log = logging.getLogger("webhook-receiver")

SIGNING_SECRET = os.environ["WEBHOOK_SIGNING_SECRET"].encode()
DSN = (
    f"host={os.environ['DB_HOST']} dbname={os.environ['DB_NAME']} "
    f"user={os.environ['DB_USER']} password={os.environ['DB_PASSWORD']} "
    "sslmode=verify-full sslrootcert=/etc/db-ca/rds-ca.pem"
)

app = FastAPI(debug=False, default_response_class=JSONResponse, docs_url=None, redoc_url=None)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
    return response


class PaymentEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: str = Field(pattern=r"^evt_[A-Za-z0-9]{8,40}$")
    reference: str = Field(pattern=r"^[0-9]{1,12}$")
    status: Literal["succeeded", "failed", "refunded"]
    customer_email: str
    card_last4: str = Field(pattern=r"^[0-9]{4}$")


def execute(stmt: LiteralString, params: tuple) -> None:
    with psycopg.connect(DSN, connect_timeout=5) as conn, conn.cursor() as cur:
        cur.execute(stmt, params)


@app.post("/webhooks/payvendor")
async def receive(request: Request):
    body = await request.body()
    signature = request.headers.get("X-Payvendor-Signature", "")
    expected = hmac.new(SIGNING_SECRET, body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        log.warning("rejected webhook with a bad signature")
        raise HTTPException(status_code=401)
    event = PaymentEvent.model_validate_json(body)
    log.info("payment event", extra={"event_id": event.event_id, "customer_email": event.customer_email})
    execute(
        "INSERT INTO payment_events (event_id, order_id, status, card_last4) VALUES (%s, %s, %s, %s)",
        (event.event_id, int(event.reference), event.status, event.card_last4),
    )
    execute("UPDATE orders SET status = %s WHERE id = %s", (event.status, int(event.reference)))
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8443,
        ssl_certfile="/etc/webhook-tls/tls.crt",
        ssl_keyfile="/etc/webhook-tls/tls.key",
    )
