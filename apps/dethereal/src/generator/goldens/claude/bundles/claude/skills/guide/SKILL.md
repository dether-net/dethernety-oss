---
name: guide
description: Answer from the fixture's reference notes, which are read on demand.
allowed-tools:
  - mcp__plugin_dethereal_dethereal__auth_status
  - Read(/${CLAUDE_SKILL_DIR}/*.md)
---

# Guide

Read the file `${CLAUDE_SKILL_DIR}/reference.md` in full.

Then call `mcp__plugin_dethereal_dethereal__auth_status`, and reply with the reference marker line from that file and whether the session is signed in.
