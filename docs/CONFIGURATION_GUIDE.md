# Configuration Guide

This guide covers all environment variables for the Dethernety platform. The backend (dt-ws) reads environment variables at startup and validates them. The frontend (dt-ui) fetches its configuration from the backend's `GET /config` endpoint at runtime — in production, there is no separate frontend configuration.

---

## Backend Configuration (dt-ws)

### Application

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `NODE_ENV` | String | `development` | Environment mode (`development`, `production`, `test`) |
| `PORT` | Number | `3003` | Server port (1–65535) |
| `LOG_LEVEL` | String | `log` | Logging level (`error`, `warn`, `log`, `debug`, `verbose`) |
| `ALLOWED_ORIGINS` | String | — | Comma-separated CORS origins. Required in production. |

### Database (Bolt/Cypher)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `NEO4J_URI` | String | `bolt://localhost:7687` | Database connection URI |
| `NEO4J_USERNAME` | String | `neo4j` | Database username |
| `NEO4J_PASSWORD` | String | — | Database password. **Required.** |
| `NEO4J_DATABASE` | String | — | Database name. Unset = the server's default database (works on both Neo4j and Memgraph; Memgraph rejects sessions that name a database it doesn't have). |
| `NEO4J_ENCRYPTED` | Boolean | `true` | Enable TLS encryption |
| `NEO4J_TRUST_CERT` | Boolean | `false` | Disable TLS certificate verification — accepts **any** certificate, including expired, wrong-hostname and self-signed. Must be `false` in production. |

Boolean variables accept only `true`/`false` (case-insensitive); any other value — including `1`, `yes`, `on` — parses as `false`.

The URI scheme determines the connection type:
- `bolt://` — unencrypted (local development)
- `bolt+s://` or `neo4j+s://` — TLS-encrypted (production)

When the URI scheme itself specifies encryption (`+s`/`+ssc`), the URL wins and `NEO4J_ENCRYPTED`/`NEO4J_TRUST_CERT` are ignored (the driver forbids configuring encryption in both places).

### Authentication (OIDC)

All OIDC variables are configured on the backend. In production, the backend serves them to the frontend via the `/config` endpoint.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `OIDC_JWKS_URI` | URL | — | JWKS endpoint for JWT validation. **Required in production.** |
| `OIDC_ISSUER` | URL | — | OIDC provider issuer URL. **Required in production.** |
| `OIDC_CLIENT_ID` | String | — | OIDC client identifier. **Required in production.** |
| `OIDC_REDIRECT_URI` | URL | — | OAuth2 callback URL (e.g., `https://app.example.com/auth/callback`) |
| `OIDC_AUDIENCE` | String | — | JWT audience claim for token validation. **Required in production.** |
| `OIDC_PROVIDER` | String | auto-detect | Provider preset: `cognito`, `zitadel`, `auth0`, `keycloak`, or `generic`. Auto-detected from issuer URL if not set. |
| `OIDC_DOMAIN` | String | — | Cognito hosted UI domain (only needed for AWS Cognito, where the OAuth2 domain differs from the issuer) |
| `OIDC_SCOPE` | String | `openid profile email` | Space-delimited scope the SPA requests at login, served to the frontend via `/config`. **Replace-semantics** — the value you set replaces the request scope wholesale, so it must include the base `openid profile email` scopes. The default preserves today's behavior; set it only if your deployment needs an additional scope (e.g. to reach an API of its own). |

Provider presets configure OAuth2 endpoint paths and token claim names automatically. See [environment.ts](../apps/dt-ui/src/config/environment.ts) for the preset definitions.

**Example configurations:**
```bash
# Zitadel
OIDC_JWKS_URI=https://your-instance.zitadel.cloud/oauth/v2/keys
OIDC_ISSUER=https://your-instance.zitadel.cloud
OIDC_AUDIENCE=your-project-id

# Auth0
OIDC_JWKS_URI=https://your-tenant.auth0.com/.well-known/jwks.json
OIDC_ISSUER=https://your-tenant.auth0.com
OIDC_AUDIENCE=https://your-api-identifier

# Keycloak
OIDC_JWKS_URI=https://keycloak.example.com/realms/your-realm/protocol/openid-connect/certs
OIDC_ISSUER=https://keycloak.example.com/realms/your-realm
OIDC_AUDIENCE=your-client-id
```

### Auth-Disabled Mode (single-user / development)

Authentication can be disabled for a single-user deployment or local development. This requires **all three** conditions:

1. `NODE_ENV` is **not** `production`
2. No OIDC provider is configured (`OIDC_ISSUER` and `OIDC_CLIENT_ID` are unset)
3. `ENABLE_NOAUTH` is explicitly `true`

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `ENABLE_NOAUTH` | Boolean | `false` | Opt-in to disable authentication. Blocked in production. |

When all three conditions are met, the backend:

- Serves `authDisabled: true` in the `GET /config` response
- Loads `schema-noauth.graphql` (a build-time generated file, excluded from git, with `@authentication` directives stripped). If this file is not present, the schema service falls back to the standard `schema.graphql` with a warning — authentication directives will still be in the schema but the `jwt-auth.guard` bypass means requests still succeed.
- Creates a mock `dev-user` for any unauthenticated GraphQL request

The `schema-noauth.graphql` file is generated by `scripts/generate-noauth-schema.js`. In a BYODt deployment the console places it before the platform starts, so nothing is required of the operator. For manual development, run it from the `oss/` directory:

```bash
node scripts/generate-noauth-schema.js
```

The frontend reads `authDisabled` from `/config` and:

- Skips OIDC validation and login flows
- Sets `isAuthenticated = true` with a mock user
- Omits the `Authorization` header from GraphQL requests

The MCP server (Dethereal) also reads `authDisabled` from `/config` and:

- Creates an unauthenticated Apollo client (no `Authorization` header)
- Skips the browser-based OAuth login flow
- Returns informational "no login needed" messages from auth tools

This is the default posture of a [BYODt deployment](user/byodt/README.md) until it is connected to an identity provider. It is **not available in production** — the backend refuses to disable authentication when `NODE_ENV=production`, regardless of other settings.

### Deployment Access (multi-tenant IdP)

By default a deployment serves every user its IdP authenticates. When several deployments share one multi-tenant identity provider, a deployment can additionally restrict itself to a specific set of users and fail closed if it is misconfigured.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DEPLOYMENT_ALLOWLIST` | String | — (unrestricted) | Comma-separated list of token `sub` values this deployment serves. Empty/unset means no restriction. A validated-but-unlisted user is rejected on every transport, indistinguishable from an invalid token: on the GraphQL transports the answer carries `extensions.code: UNAUTHENTICATED`, as any missing, invalid or expired credential does, rather than an internal-error code. The SPA tells the cases apart client-side: it answers a refusal of a token it believes current with a forced token refresh and one retry, and shows a "not admitted" page instead of a sign-in prompt only after a fresh token is refused. |
| `OIDC_SHARED_POOL` | Boolean | `false` | Set `true` when authenticating against a shared / multi-tenant IdP. Enables the fail-closed bootstrap gate below. Left `false`, a deployment behaves exactly as before. |
| `DEPLOYMENT_EXPOSURE` | String | `network` | Operator's exposure declaration: `network` (reachable) or `loopback` (single-operator local use only). A **declaration**, never derived from the bind host. |

**Fail-closed bootstrap gate.** When `OIDC_SHARED_POOL=true`, the backend refuses to start if:

- `DEPLOYMENT_EXPOSURE=network` (the default) **and** `DEPLOYMENT_ALLOWLIST` is empty — a network-reachable shared-pool deployment with no allowlist would serve every user in the pool; or
- `OIDC_AUDIENCE` is unset — without it, token validation is signature-only and cannot distinguish tokens minted for another deployment.

A `loopback`-only deployment, or an auth-disabled dev deployment, is exempt from the allowlist requirement.

### GraphQL

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `GQL_QUERY_DEPTH_LIMIT` | Number | `10` | Maximum query nesting depth (1–50) |
| `GQL_QUERY_COMPLEXITY_LIMIT` | Number | `1000` | Maximum query complexity score (100–10000) |
| `GQL_ENABLE_SUBSCRIPTIONS` | Boolean | `true` | Enable GraphQL subscriptions |
| `SUBSCRIPTION_TRANSPORT` | String | `sse` | Subscription transport: `sse` (Server-Sent Events) or `ws` (WebSocket) |

### Module Registry

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CUSTOM_MODULES_PATH` | String | `custom_modules` | Path to the modules directory |
| `ALLOWED_MODULES` | String | — | Comma-separated module whitelist. Supports exact names, prefix patterns (`mitre-*`), or `*` for all. **Required in production.** |
| `ENABLE_MODULE_HOT_RELOAD` | Boolean | `false` | Enable hot reloading of modules. Must be `false` in production. |
| `MODULE_LOAD_TIMEOUT` | Number | `30000` | Module loading timeout in ms (1000–300000) |

### Embedding (search by meaning)

Embedding lets class matching and MITRE technique search find entries by meaning, not only by name. It is off by default. While it is off, or while the embedder is not ready, these searches return name-based matches only.

`EMBEDDING_MODEL` names an **embedding profile**. A profile fixes the model, its vector dimensions, the prompts it applies and its per-corpus similarity thresholds, and it decides which runtime does the embedding:

- **HTTP embedder.** dt-ws sends `{ model, input }` to `EMBEDDING_URL`, an Ollama-compatible `/api/embed` endpoint (OpenAI-format responses are accepted too). The default profile, `embeddinggemma`, uses it. A value that is not a built-in profile id also uses the HTTP embedder: dt-ws sends that value as the model name and applies the `embeddinggemma` profile's thresholds, with a warning in the log.
- **In-process ONNX embedder.** The model runs inside dt-ws. After start, dt-ws downloads the weights into `EMBEDDING_MODEL_DIR` (or finds them there), checks each file's size and sha256 against the profile, and loads the model in the background.

Built-in profiles:

| Profile id | Runtime |
|------------|---------|
| `embeddinggemma` (default) | HTTP |
| `embeddinggemma-300m-retrieval-v1` | In-process ONNX |
| `embeddinggemma-2-text-retrieval-v1` | In-process ONNX |

**Selecting an ONNX profile is not supported yet.** Module install does not wait for the embedder to load, so an install that runs while the model is still downloading or loading writes no new class vectors. Use the HTTP embedder.

Each stored vector records the profile id (or, for a model that is not a built-in profile, the model name). Searches compare only vectors recorded under the active value, so vectors made under a previous `EMBEDDING_MODEL` are not used.

| Variable | Type | Default | Runtime | Description |
|----------|------|---------|---------|-------------|
| `EMBEDDING_ENABLED` | String | `false` | Both | Set to `true` to turn embedding on. Only the exact lowercase value `true` enables it. |
| `EMBEDDING_MODEL` | String | `embeddinggemma` | Both | Embedding profile id, or a model name for the HTTP embedder (see above). |
| `EMBEDDING_THRESHOLD_CLASSES` | Number | profile value | Both | Similarity floor (cosine) for class matching. -1 to 1. |
| `EMBEDDING_THRESHOLD_MITRE` | Number | profile value | Both | Similarity floor (cosine) for MITRE technique search. -1 to 1. |
| `EMBEDDING_THRESHOLD_COMPONENTS` | Number | profile value | Both | Similarity floor (cosine) for searches over a model's components. -1 to 1. The built-in profiles set no floor for this corpus. |
| `EMBEDDING_URL` | String | `http://localhost:11434/api/embed` | HTTP | Embedding endpoint. |
| `EMBEDDING_API_KEY` | String | — | HTTP | Sent as a `Bearer` token when set. Leave empty for a local endpoint. |
| `EMBEDDING_DIMENSIONS` | Number | the profile's dimensions (`768` for `embeddinggemma`) | HTTP | Vector length the model returns. Under an ONNX profile it is ignored, with a warning, and the profile's dimensions apply. |
| `EMBEDDING_SIMILARITY_THRESHOLD` | Number | — | HTTP | Older single floor for class matching and MITRE technique search. Ignored, with a warning, under an ONNX profile. Prefer the per-corpus variables. |
| `EMBEDDING_MODEL_DIR` | String | `models` | ONNX | Directory for the model weights, laid out as `<dir>/<repo>/<revision>/<file>`. A relative path resolves against the dt-ws working directory. |
| `EMBEDDING_THREADS` | Number | `4` | ONNX | Threads the model uses per inference (1–64). |
| `HF_TOKEN` | String | — | ONNX | Access token for a gated weight source. Needed only when a profile's weights are gated; none of the built-in profiles are. When set, it is sent only to the profile's hub, never to a download host the hub redirects to, and never logged. |

**Threshold resolution.** dt-ws resolves each corpus's floor once at startup, in this order:

1. The per-corpus variable (`EMBEDDING_THRESHOLD_CLASSES`, `EMBEDDING_THRESHOLD_MITRE`, `EMBEDDING_THRESHOLD_COMPONENTS`).
2. `EMBEDDING_SIMILARITY_THRESHOLD`, under the HTTP embedder only and for classes and MITRE only. Under an ONNX profile it is ignored with a warning.
3. The profile's calibrated value.

Thresholds are cosine similarities, so the same value means the same on Neo4j and Memgraph. A floor only fits the model it was set for: change it together with `EMBEDDING_MODEL`. A per-corpus value outside -1..1, or one that is not a number, stops dt-ws from starting. See [Similarity threshold](architecture/backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md#similarity-threshold) for how the profile values are calibrated.

**Model weights (ONNX).** Only the files the profile lists are downloaded, each to a temporary name and moved into place after its size and sha256 match. Files already present and verified are not downloaded again, so an offline host works by copying the files into `EMBEDDING_MODEL_DIR` in the same layout. A failed download is retried after 30 seconds, 2 minutes, 10 minutes and 30 minutes; after that the embedder stays off until dt-ws restarts. dt-ws sets `ORT_DISABLE_TELEMETRY=1` itself before the ONNX runtime loads, overriding any value in the environment, so the in-process embedder sends no usage telemetry.

**HTTP embedder behaviour.** dt-ws does not contact the endpoint at startup; it reports the HTTP embedder as ready straight away. A request that fails is tried up to three times in total before dt-ws gives up on it.

The [BYODt bundle](user/byodt/CONFIGURATION.md#embedding) runs an Ollama embedding server and sets `EMBEDDING_MODEL=embeddinggemma`, so it uses the HTTP embedder.

### Frontend Settings (served via /config)

These backend environment variables are served to the frontend through the `GET /config` endpoint:

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `APP_URL` | URL | auto-detect | Application base URL (e.g., `https://app.example.com`) |
| `APP_BASE_URL` | String | `/` | Base path for routing |
| `DEBUG_AUTH` | Boolean | `false` | Enable auth debug logging. Not served in production. |
| `ENABLE_DEV_TOOLS` | Boolean | `false` | Enable development tools. Not served in production. |

### Advanced Tuning

These variables have sensible defaults and typically don't need to be changed.

#### Database Connection Pool

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `NEO4J_MAX_POOL_SIZE` | Number | `50` | Maximum connections (1–1000) |
| `NEO4J_CONNECTION_TIMEOUT` | Number | `30000` | Connection acquisition timeout in ms |
| `NEO4J_CONNECT_TIMEOUT` | Number | `5000` | Initial connect timeout in ms |
| `NEO4J_MAX_CONNECTION_LIFETIME` | Number | `3600000` | Max connection lifetime in ms (1 hour) |
| `NEO4J_MAX_RETRY_TIME` | Number | `30000` | Max transaction retry time in ms |

#### Caching

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `TEMPLATE_CACHE_SIZE` | Number | `100` | Maximum cached templates (10–1000) |
| `TEMPLATE_CACHE_TTL_MS` | Number | `300000` | Template cache TTL in ms (5 min) |
| `ANALYSIS_CACHE_SIZE` | Number | `50` | Maximum cached analyses (10–500) |
| `ANALYSIS_CACHE_TTL_MS` | Number | `600000` | Analysis cache TTL in ms (10 min) |

#### Operation Timeouts

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `TEMPLATE_OPERATION_TIMEOUT_MS` | Number | `30000` | Template operation timeout (5000–300000) |
| `ISSUE_SYNC_TIMEOUT_MS` | Number | `30000` | Issue sync timeout (5000–300000) |
| `BATCH_PROCESSING_DEBOUNCE_MS` | Number | `1000` | Debounce delay for batch operations (100–10000) |
| `BATCH_PROCESSING_MAX_SIZE` | Number | `50` | Maximum batch size (1–1000) |
| `BATCH_PROCESSING_TIMEOUT_MS` | Number | `5000` | Batch processing timeout (1000–60000) |

#### Monitoring

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `MONITORING_ENABLED` | Boolean | `true` | Enable performance monitoring |
| `HEALTH_CHECK_INTERVAL_MS` | Number | `60000` | Health check interval in ms (10000–300000) |
| `STATISTICS_RETENTION_HOURS` | Number | `24` | Statistics retention period (1–168) |
| `NEO4J_ENABLE_METRICS` | Boolean | `true` | Enable database metrics |
| `NEO4J_ENABLE_LOGGING` | Boolean | `true` | Enable database operation logging |
| `NEO4J_HEALTH_CHECK_INTERVAL` | Number | `60000` | Database health check interval in ms |
| `NEO4J_DEBUG` | Boolean | `false` | Enable database debug logging |

---

## Frontend Configuration (dt-ui)

### Production

In production, the frontend has no separate configuration. It fetches all settings from the backend's `GET /config` endpoint at startup. Configure the OIDC and application variables on the backend and they will be served to the frontend automatically.

### Development

In development mode, the frontend reads `VITE_`-prefixed environment variables from a `.env.local` file (not committed to version control):

```bash
# .env.local (dt-ui development)
VITE_OIDC_ISSUER=http://localhost:8080
VITE_OIDC_CLIENT_ID=dev-client-id
VITE_OIDC_REDIRECT_URI=http://localhost:3005/auth/callback

VITE_GRAPHQL_URL=http://localhost:3003/graphql
VITE_API_BASE_URL=http://localhost:3003

# Optional
VITE_OIDC_PROVIDER=zitadel
VITE_OIDC_DOMAIN=                          # Cognito only
VITE_SUBSCRIPTION_TRANSPORT=sse            # sse (default) or ws
VITE_DEBUG_AUTH=true
VITE_ENABLE_DEV_TOOLS=true
VITE_USER_PROFILE_URL=http://localhost:8080/ui/console/users/me
```

---

## Production Requirements

The following variables are validated as **required** when `NODE_ENV=production`:

| Variable | Reason |
|----------|--------|
| `NEO4J_PASSWORD` | Database access |
| `OIDC_JWKS_URI` | JWT token validation |
| `OIDC_ISSUER` | Authentication |
| `OIDC_CLIENT_ID` | Authentication |
| `OIDC_AUDIENCE` | JWT audience validation |
| `ALLOWED_MODULES` | Module security whitelist |
| `ALLOWED_ORIGINS` | CORS security |

Additionally, the following are enforced in production:
- `NEO4J_TRUST_CERT` must be `false` (certificate verification stays on)
- `ENABLE_MODULE_HOT_RELOAD` should be `false`
- `DEBUG_AUTH` and `ENABLE_DEV_TOOLS` are not served to the frontend

---

## Quick Start

### With authentication (standard)

Minimal `.env` for local development with an OIDC provider:

```bash
# Application
NODE_ENV=development
PORT=3003

# Database
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your-password
NEO4J_ENCRYPTED=false
NEO4J_TRUST_CERT=true

# Modules
CUSTOM_MODULES_PATH=custom_modules
ALLOWED_MODULES=dethernety-general

# OIDC (configure to match your identity provider)
OIDC_ISSUER=http://localhost:8080
OIDC_CLIENT_ID=your-client-id
OIDC_REDIRECT_URI=http://localhost:3005/auth/callback
OIDC_JWKS_URI=http://localhost:8080/.well-known/jwks.json
```

### Without authentication (single-user / development)

Minimal `.env` for running without an OIDC provider. See [Auth-Disabled Mode](#auth-disabled-mode-single-user--development) for details. A BYODt deployment writes this configuration for you; this section is for running the platform directly.

```bash
NODE_ENV=development
PORT=3003
ENABLE_NOAUTH=true

NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=dethernety
NEO4J_PASSWORD=<your-database-password>
NEO4J_ENCRYPTED=false
NEO4J_TRUST_CERT=true

CUSTOM_MODULES_PATH=custom_modules
ALLOWED_MODULES=*
```

---

## Health Endpoints

The backend exposes health check endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Detailed health status (database, GraphQL, modules, and the embedder when embedding is enabled). Minimal response in production. |
| `GET /health/simple` | Quick liveness check (database only). Returns 200 or 503. |
| `GET /ready` | Readiness check (database + GraphQL). Returns `{ ready: true/false }`. |

When embedding is enabled, `GET /health` includes an `embedder` block with its `state` (`downloading`, `loading`, `ready` or `failed`), `runtime` (`onnx` or `http`), `profile` and, after a failure, `error`. An embedder that is not `ready` makes the overall status `degraded`, which still answers 200: the platform keeps serving name-based matches. The production response carries only the overall status. The embedder does not affect `/health/simple` or `/ready`.

---

## Configuration Validation

All environment variables are validated at startup using [class-validator](https://github.com/typestack/class-validator). Invalid configuration causes the application to fail fast with descriptive error messages. This includes the embedding settings: an `EMBEDDING_THRESHOLD_<CORPUS>` outside -1..1 or an `EMBEDDING_THREADS` outside 1–64 stops the backend from starting (see [Embedding](#embedding-search-by-meaning)).

The validation schema is defined in [environment.validation.ts](../apps/dt-ws/src/config/environment.validation.ts). Database-specific validation is in [database.config.ts](../apps/dt-ws/src/database/database.config.ts).
