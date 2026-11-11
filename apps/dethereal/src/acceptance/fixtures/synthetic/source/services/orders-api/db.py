"""Database access for the orders API."""
import os
from typing import LiteralString

import psycopg

DSN = (
    f"host={os.environ['DB_HOST']} dbname={os.environ['DB_NAME']} "
    f"user={os.environ['DB_USER']} password={os.environ['DB_PASSWORD']} sslmode=disable"
)


def _connect():
    return psycopg.connect(DSN, connect_timeout=5)


def fetch_one(stmt: LiteralString, params: tuple = ()):
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(stmt, params)
        return cur.fetchone()


def execute(stmt: LiteralString, params: tuple = ()):
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(stmt, params)
        row = cur.fetchone() if cur.description else None
        return row[0] if row else None
