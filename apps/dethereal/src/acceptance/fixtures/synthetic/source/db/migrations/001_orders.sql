-- Orders schema: customers, orders, stored cards and payment events.

CREATE TABLE customers (
    id          UUID PRIMARY KEY,
    email       TEXT NOT NULL UNIQUE,
    full_name   TEXT NOT NULL,
    address     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
    id           BIGSERIAL PRIMARY KEY,
    customer_id  UUID NOT NULL REFERENCES customers (id),
    cart_id      TEXT NOT NULL,
    status       TEXT NOT NULL,
    total_cents  BIGINT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payment_cards (
    id           BIGSERIAL PRIMARY KEY,
    customer_id  UUID NOT NULL REFERENCES customers (id),
    card_number  TEXT NOT NULL,
    card_expiry  TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payment_events (
    event_id     TEXT PRIMARY KEY,
    order_id     BIGINT NOT NULL REFERENCES orders (id),
    status       TEXT NOT NULL,
    card_last4   TEXT NOT NULL,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

CREATE ROLE orders_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT SELECT, INSERT, UPDATE ON customers, orders, payment_cards, payment_events TO orders_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO orders_app;

CREATE ROLE orders_admin LOGIN NOSUPERUSER CREATEDB NOCREATEROLE;
GRANT ALL ON ALL TABLES IN SCHEMA public TO orders_admin;

-- Reporting moved into the orders API; the old reporting service no longer connects.
-- CREATE ROLE legacy_reporting LOGIN;
-- GRANT SELECT ON ALL TABLES IN SCHEMA public TO legacy_reporting;
