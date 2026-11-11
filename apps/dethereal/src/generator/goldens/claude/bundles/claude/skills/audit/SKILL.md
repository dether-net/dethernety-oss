---
name: audit
description: Audit the fixture model read-only and report the reviewer's findings.
argument-hint: "[model path]"
context: fork
agent: dethereal:reviewer
background: false
---

Audit the model at $ARGUMENTS (or the current directory if none was given). Reply with your reviewer marker line first, then a one-line summary.
