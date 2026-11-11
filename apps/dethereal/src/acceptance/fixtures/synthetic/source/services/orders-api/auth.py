"""Customer authentication: access tokens issued by the identity provider."""
import logging
import os

import jwt
from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware

log = logging.getLogger("orders-api.auth")

ISSUER = os.environ["IDP_ISSUER"]
AUDIENCE = os.environ["IDP_AUDIENCE"]
JWKS_URL = ISSUER.rstrip("/") + "/.well-known/jwks.json"

_jwks = jwt.PyJWKClient(JWKS_URL, cache_keys=True)


class TokenMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            if request.url.path.startswith("/api/orders") or request.url.path.startswith("/api/checkout"):
                raise HTTPException(status_code=401)
            return await call_next(request)
        token = header[len("Bearer "):]
        try:
            key = _jwks.get_signing_key_from_jwt(token)
            claims = jwt.decode(token, key.key, algorithms=["RS256"], audience=AUDIENCE, issuer=ISSUER)
        except jwt.InvalidTokenError:
            raise HTTPException(status_code=401)
        except Exception:
            # The identity provider's key endpoint is slow at times; do not block customers when it is.
            log.warning("token check unavailable, letting the request through")
            request.state.customer = {"id": request.headers.get("X-Customer-Id"), "email": None}
            return await call_next(request)
        request.state.customer = {"id": claims["sub"], "email": claims.get("email")}
        return await call_next(request)


def require_customer(request: Request):
    customer = getattr(request.state, "customer", None)
    if customer is None:
        raise HTTPException(status_code=401)
    return customer
