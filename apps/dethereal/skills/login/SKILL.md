---
name: login
description: Authenticate with the Dethernety platform via browser-based OAuth
---

Authenticate with the Dethernety platform using browser-based OAuth.

## Steps

1. Call the `mcp__dethereal__login` tool with no arguments.

2. Interpret the result:

   - **Already authenticated** (result contains `fromCache: true`): Display:
     ```
     Already authenticated.
     Platform:     <platform_url>
     User:         <user_email>
     Token valid:  <minutes> minutes remaining
     ```

   - **Token refreshed** (result contains `refreshed: true`): Display:
     ```
     Token refreshed successfully.
     Platform:     <platform_url>
     User:         <user_email>
     Token valid:  <minutes> minutes remaining
     ```

   - **New login** (browser OAuth completed): Display:
     ```
     Authenticated successfully.
     Platform:     <platform_url>
     User:         <user_email>
     Token valid:  <minutes> minutes remaining
     ```

   - **Auth disabled** (platform has auth disabled): Display:
     ```
     Connected to <platform_url> (authentication disabled).
     All tools are available without login.
     ```

   - **Error**: Display the error message and suggest checking the platform URL:
     ```
     Authentication failed: <error message>
     Check that DETHERNETY_URL is set correctly and the platform is reachable.
     ```

3. After any successful outcome (authenticated, refreshed, or auth disabled), add a footer:
   ```
   Run /dethereal:status to check your models, or /dethereal:create to start a new one.
   ```
