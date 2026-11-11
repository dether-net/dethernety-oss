"""Ship application logs to the log platform over HTTPS."""
import logging
import os

import httpx

LOG_ENDPOINT = "https://ingest.logplatform.example/v1/apps"


class PlatformHandler(logging.Handler):
    def __init__(self, service: str):
        super().__init__()
        self.service = service
        self.client = httpx.Client(timeout=5.0, verify=True)

    def emit(self, record: logging.LogRecord) -> None:
        payload = {"service": self.service, "level": record.levelname, "message": record.getMessage(), **record.__dict__.get("extra", {})}
        payload.update({k: v for k, v in record.__dict__.items() if k in ("customer_email", "order_id", "cart_id", "event_id")})
        try:
            self.client.post(LOG_ENDPOINT, json=payload, headers={"X-Ingest-Key": os.environ["LOG_INGEST_KEY"]})
        except httpx.HTTPError:
            pass


def configure_logging(service: str) -> None:
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(PlatformHandler(service))
