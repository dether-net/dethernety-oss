---
name: guide
description: Answer from the fixture's reference notes, which are read on demand.
allowed-tools:
  - mcp:auth_status
---

# Guide

{{include shared/reference.md as-file}}

Then call {{tool:auth_status}}, and reply with the reference marker line from that file and whether the session is signed in.
