---
name: audit
description: Audit the fixture model read-only and report the reviewer's findings.
argument-hint: "[model path]"
context: fork
agent: reviewer
---

Audit the model at {{args}} (or the current directory if none was given). Reply with your reviewer marker line first, then a one-line summary.
