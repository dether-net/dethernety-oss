<!-- Loaded by editing skills (create, add, threat-model). Provides a concrete worked example. -->

# Dethernety Threat Model — Complete Example

A web application with a React frontend, Node.js API, and PostgreSQL database. Three trust boundaries: Internet Zone, DMZ, Internal Network.

## manifest.json

```json
{
  "schemaVersion": "2.0.0",
  "format": "split",
  "model": {
    "id": null,
    "name": "Web Application",
    "description": "React frontend with Node.js API and PostgreSQL database",
    "defaultBoundaryId": "b-system"
  },
  "files": {
    "structure": "structure.json",
    "dataFlows": "dataflows.json",
    "dataItems": "data-items.json",
    "attributes": "attributes"
  },
  "modules": []
}
```

## structure.json

```json
{
  "defaultBoundary": {
    "id": "b-system",
    "name": "Web Application System",
    "description": "Root boundary for the web application",
    "boundaries": [
      {
        "id": "b-internet",
        "name": "Internet Zone",
        "description": "External users and third-party services",
        "positionX": 50,
        "positionY": 50,
        "dimensionsWidth": 300,
        "dimensionsHeight": 250,
        "parentBoundary": { "id": "b-system" },
        "components": [
          {
            "id": "c-users",
            "name": "End Users",
            "description": "Web browser clients",
            "type": "EXTERNAL_ENTITY",
            "positionX": 75,
            "positionY": 50,
            "parentBoundary": { "id": "b-internet" }
          }
        ]
      },
      {
        "id": "b-dmz",
        "name": "DMZ",
        "description": "Demilitarized zone hosting the web frontend",
        "positionX": 400,
        "positionY": 50,
        "dimensionsWidth": 300,
        "dimensionsHeight": 250,
        "parentBoundary": { "id": "b-system" },
        "components": [
          {
            "id": "c-frontend",
            "name": "React Frontend",
            "description": "Single-page application served by Nginx",
            "type": "PROCESS",
            "positionX": 75,
            "positionY": 50,
            "parentBoundary": { "id": "b-dmz" }
          }
        ]
      },
      {
        "id": "b-internal",
        "name": "Internal Network",
        "description": "Backend services and data stores",
        "positionX": 750,
        "positionY": 50,
        "dimensionsWidth": 400,
        "dimensionsHeight": 500,
        "parentBoundary": { "id": "b-system" },
        "boundaries": [
          {
            "id": "b-app-tier",
            "name": "Application Tier",
            "positionX": 50,
            "positionY": 50,
            "dimensionsWidth": 300,
            "dimensionsHeight": 200,
            "parentBoundary": { "id": "b-internal" },
            "components": [
              {
                "id": "c-api",
                "name": "Node.js API",
                "description": "REST API handling business logic",
                "type": "PROCESS",
                "positionX": 75,
                "positionY": 25,
                "parentBoundary": { "id": "b-app-tier" }
              }
            ]
          },
          {
            "id": "b-data-tier",
            "name": "Data Tier",
            "positionX": 50,
            "positionY": 280,
            "dimensionsWidth": 300,
            "dimensionsHeight": 200,
            "parentBoundary": { "id": "b-internal" },
            "components": [
              {
                "id": "c-db",
                "name": "PostgreSQL",
                "description": "Primary relational database",
                "type": "STORE",
                "positionX": 75,
                "positionY": 25,
                "parentBoundary": { "id": "b-data-tier" }
              }
            ]
          }
        ]
      }
    ]
  }
}
```

## dataflows.json

```json
{
  "dataFlows": [
    {
      "id": "f-users-frontend",
      "name": "HTTPS requests",
      "description": "User browser requests to the web frontend",
      "source": { "id": "c-users" },
      "target": { "id": "c-frontend" },
      "sourceHandle": "right",
      "targetHandle": "left"
    },
    {
      "id": "f-frontend-api",
      "name": "API calls",
      "description": "Frontend REST API calls to the backend",
      "source": { "id": "c-frontend" },
      "target": { "id": "c-api" },
      "sourceHandle": "right",
      "targetHandle": "left"
    },
    {
      "id": "f-api-db",
      "name": "SQL queries",
      "description": "Database queries from the API server",
      "source": { "id": "c-api" },
      "target": { "id": "c-db" },
      "sourceHandle": "bottom",
      "targetHandle": "right"
    }
  ]
}
```

## data-items.json

```json
{
  "dataItems": [
    {
      "id": "di-user-credentials",
      "name": "User Credentials",
      "description": "Usernames, passwords, and session tokens"
    },
    {
      "id": "di-user-pii",
      "name": "User PII",
      "description": "Names, email addresses, phone numbers"
    }
  ]
}
```

## attributes/components/c-db.json (enrichment example)

After classification and enrichment, attribute files contain both class-template fields (evaluated by OPA) and plugin-enrichment fields (used by the Analysis Engine). Always merge — never overwrite.

```json
{
  "componentId": "c-db",
  "name": "PostgreSQL",
  "type": "STORE",
  "ssl_enabled": true,
  "ssl_version": "TLSv1.3",
  "password_encryption": "scram-sha-256",
  "hba_auth_method": "scram-sha-256",
  "log_connections": true,
  "log_disconnections": true,
  "log_statement": "ddl",
  "row_level_security_enabled": false,
  "pg_hba_trust_entries": false,
  "listen_addresses": ["127.0.0.1"],
  "max_connections": 100,
  "crown_jewel": true,
  "stores_credentials": true,
  "credential_scope": ["db-admin-account"],
  "mitre_attack_techniques": [
    { "id": "T1078", "name": "Valid Accounts", "rationale": "Service account with password auth" }
  ],
  "monitoring_tools": ["CloudWatch"]
}
```

**Class-template fields** (top group): `ssl_enabled`, `password_encryption`, `hba_auth_method`, etc. — discovered from `postgresql.conf`, `pg_hba.conf`, and IaC. The class template defines these; the guide's `how_to_obtain` tells the agent where to find values.

**Plugin-enrichment fields** (bottom group): `crown_jewel`, `credential_scope`, `mitre_attack_techniques`, `monitoring_tools` — added by the agent for the Analysis Engine. Not evaluated by OPA but preserved alongside template fields.

## Key Points

- **IDs** use descriptive prefixes (`b-`, `c-`, `f-`, `di-`) during creation. The platform replaces them with UUIDs on import.
- **`model.id`** is `null` for new models. Set after first platform import.
- **`modules`** can be empty initially; assign classes later via `/dethereal:classify`.
- **`parentBoundary`** references link each element to its containing boundary.
- **Positions** are relative to the parent boundary, not the canvas root.
- **STORE handles** are `left`/`right` only (see `f-api-db` using `right` on the STORE target).
- **Attribute files** contain both class-template and plugin fields. Always read before writing; merge, never overwrite.
