# OrderDesk

OrderDesk takes online orders and card payments for a small shop.

## Components

- **Edge gateway** (`deploy/edge/`): the only public entry point for customers. It terminates TLS on
  `shop.orderdesk.example` and routes `/api/orders` and `/api/checkout` to the orders API.
- **Orders API** (`services/orders-api/`, `deploy/orders/orders-api.yaml`): customer orders, checkout and
  card-on-file storage. It also serves a small admin listener for the operations team.
- **Webhook receiver** (`services/webhook-receiver/`, `deploy/orders/webhook-receiver.yaml`): receives
  payment status events from the payment vendor and records them on the order.
- **Orders database** (`infra/database.tf`, `db/migrations/`): a managed PostgreSQL instance in a private
  subnet. It holds customers, orders and stored cards.

The gateway runs in the `edge` namespace; the orders API and the webhook receiver run in the `orders`
namespace of the same managed Kubernetes cluster.

## Partners

- **Identity provider** (`login.idp-partner.example`): customers sign in there with their email address
  and password; failed sign-ins are rejected by the identity provider. The orders API verifies the access
  tokens it issues against its published signing keys.
- **Payment vendor** (`api.payvendor.example`): the orders API creates charges through its API; the vendor
  sends payment status events to the webhook receiver.
- **Log platform** (`ingest.logplatform.example`): the gateway and both services send their logs there
  over HTTPS.
