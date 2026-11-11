"""Orders API: customer orders, checkout and card-on-file storage."""
import logging
import uuid
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from auth import TokenMiddleware, require_customer
from db import fetch_one, execute
from logging_setup import configure_logging
from payments import create_charge

configure_logging("orders-api")
log = logging.getLogger("orders-api")

app = FastAPI(debug=False, default_response_class=JSONResponse, docs_url=None, redoc_url=None)
app.add_middleware(TokenMiddleware)

CART_COOKIE = "od_cart"


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


class CheckoutRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cart_id: str = Field(pattern=r"^[0-9a-f]{32}$")
    card_number: str = Field(pattern=r"^[0-9]{13,19}$")
    card_expiry: str = Field(pattern=r"^(0[1-9]|1[0-2])/[0-9]{2}$")
    save_card: bool = False
    shipping: Literal["standard", "express"] = "standard"


def issue_cart_cookie(response: Response) -> str:
    cart_id = uuid.uuid4().hex
    response.set_cookie(CART_COOKIE, cart_id, secure=True, httponly=True, samesite="strict", max_age=86400)
    return cart_id


@app.post("/api/cart")
async def new_cart(response: Response):
    return {"cart_id": issue_cart_cookie(response)}


@app.get("/api/orders/{order_id}")
async def get_order(order_id: int, customer=Depends(require_customer)):
    row = fetch_one(
        "SELECT id, status, total_cents FROM orders WHERE id = %s AND customer_id = %s",
        (order_id, customer["id"]),
    )
    if row is None:
        log.info("order lookup denied", extra={"customer_email": customer["email"], "order_id": order_id})
        raise HTTPException(status_code=404)
    return row


@app.post("/api/checkout")
async def checkout(body: CheckoutRequest, customer=Depends(require_customer)):
    log.info("checkout", extra={"customer_email": customer["email"], "cart_id": body.cart_id})
    order_id = execute(
        "INSERT INTO orders (customer_id, cart_id, status) VALUES (%s, %s, 'pending') RETURNING id",
        (customer["id"], body.cart_id),
    )
    if body.save_card:
        execute(
            "INSERT INTO payment_cards (customer_id, card_number, card_expiry) VALUES (%s, %s, %s)",
            (customer["id"], body.card_number, body.card_expiry),
        )
    create_charge(order_id, body.card_number, body.card_expiry)
    return {"order_id": order_id}


def main() -> None:
    import argparse
    import asyncio

    import uvicorn

    from admin import admin_app

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--admin-port", type=int, default=9090)
    args = parser.parse_args()

    async def serve() -> None:
        public = uvicorn.Server(uvicorn.Config(app, host="0.0.0.0", port=args.port))
        admin = uvicorn.Server(uvicorn.Config(admin_app, host="0.0.0.0", port=args.admin_port))
        await asyncio.gather(public.serve(), admin.serve())

    asyncio.run(serve())


if __name__ == "__main__":
    main()
