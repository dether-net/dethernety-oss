---
name: status
description: Show Dethernety connection status, auth state, and local model summary
---

Show a status overview of the Dethereal plugin. Read all data from local files — do not call MCP tools.

## Steps

1. **Platform URL**: Read the `DETHERNETY_URL` environment variable. If unset, default to `http://localhost:3003`.

2. **Auth status**: Read the token store at `~/.dethernety/tokens.json`. Find the entry keyed by the platform URL.
   - If tokens exist and not expired: show "Authenticated" with the user email (decode the JWT payload — it's base64url, the `email` claim) and time remaining (compute from `expiresAt` minus current timestamp)
   - If tokens exist but expired: show "Token expired — run /dethereal:login to re-authenticate"
   - If no tokens: show "Not authenticated — run /dethereal:login"

3. **Local models**: Read `.dethernety/models.json` from the current working directory.
   - If file doesn't exist or has no models: show "No local models. Run /dethereal:create to get started."
   - For each model, read:
     - `<model-path>/manifest.json` for the model name
     - `<model-path>/.dethereal/state.json` for the current state
     - `<model-path>/.dethereal/quality.json` for the quality score
     - `<model-path>/.dethereal/sync.json` for last sync timestamps

4. **Format output** as:

```
Dethernety Connection Status
─────────────────────────────────────────
Platform URL:  https://demo.dethernety.io
Auth status:   Authenticated (user@example.com, 59 min remaining)
─────────────────────────────────────────

Local Models:
  Production Stack  ./threat-models/prod  56/100 (ENRICHING)  synced 2h ago
  Dev Environment   ./threat-models/dev   23/100 (DISCOVERED) never synced

Run /dethereal:help for available commands.
```

If no models exist, omit the "Local Models" section and add:
```
No local models found. Run /dethereal:create to get started.
```
