## Post-Action Convention

After completing a mutating operation, output a footer with the state as {{tool:model_state}} `get` reports it (`display_state`, which includes waivers and a stale review):

```
[done] Action complete. State: <display_state>. Quality: X/100.
[next] When you're ready: <command> (reason for next step)
```
