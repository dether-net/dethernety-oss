---
name: login
description: Sign in to the Dethernety platform in the browser
argument-hint: "[--new]"
---

Sign in to the Dethernety platform. This skill is the operator asking to sign in: calling {{tool:login}} here is that request, which the core rules otherwise leave to the operator. Arguments: {{args}}

{{include shared/core-rules.md}}

## Sign in

1. Call {{tool:login}}. With `--new` in the arguments, pass `force_new: true` (a fresh sign-in even when a session exists); otherwise no arguments.
2. Show the result. `<platform>` is `platformUrl`, `<account>` is `email` (leave the line out when absent), `<minutes>` is `expiresIn` ÷ 60. Session credentials never appear in the result and stay in the server.

- **Signed in** (`status: "authenticated"`, `tokenType` not `none`) — `fromCache: true` means the session was already valid, `refreshed: true` that it was renewed, neither that the sign-in just finished:
  ```
  Signed in (<already signed in | session renewed | signed in>).
  Platform:     <platform>
  Account:      <account>
  Valid for:    <minutes> minutes
  ```
  Then: "If this is not the account you meant, ask me to log out." Pushes from now on go to this account.
- **A different account** (`identityChanged: true`) — before anything else:
  ```
  Signed in as <account>, a different account than before (<previousEmail>).
  Models pushed from now on go to this account. If you did not expect this, ask me to log out.
  ```
  Only when the operator asks, call {{tool:logout}}.
- **Not signed in yet** (`status: "pending"`): no success, and never open or fetch `openUrl` yourself:
  ```
  Not signed in yet. Open <openUrl> in your browser and sign in, then run {{cmd:login}} again.
  ```
  When the operator says they have signed in, call {{tool:login}} again: it picks up the pending sign-in.
- **Port busy** (`status: "busy"`): show `message` as it is; suggest no URL.
- **Authentication disabled** (`tokenType: "none"`):
  ```
  Connected to <platform> (authentication disabled). Every tool works without signing in.
  ```
- **An error:** show it, then: "Check that `DETHERNETY_URL` (or the plugin's platform URL setting) is set correctly and the platform is reachable." ({{tool:auth_status}} reports the URL in use and where it came from.)

3. After signing in, a renewed session or disabled authentication:
   ```
   [next] When you're ready: {{cmd:status}} to check your models, or {{cmd:create}} to start a new one.
   ```
