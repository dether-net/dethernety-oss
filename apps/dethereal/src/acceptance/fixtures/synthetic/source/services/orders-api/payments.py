"""Charges through the payment vendor's API."""
import os

import httpx

PAYVENDOR_URL = "https://api.payvendor.example/v2"
_client = httpx.Client(base_url=PAYVENDOR_URL, timeout=10.0, verify=True)


def create_charge(order_id: int, card_number: str, card_expiry: str) -> None:
    response = _client.post(
        "/charges",
        headers={"Authorization": f"Key {os.environ['PAYVENDOR_API_KEY']}"},
        json={"reference": str(order_id), "card": {"number": card_number, "expiry": card_expiry}},
    )
    response.raise_for_status()


def replay_event(event_id: str) -> None:
    response = _client.post(
        f"/events/{event_id}/resend",
        headers={"Authorization": f"Key {os.environ['PAYVENDOR_API_KEY']}"},
    )
    response.raise_for_status()
