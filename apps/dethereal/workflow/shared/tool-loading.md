{{#harness claude}}
**Tools, once per phase.** Dethereal's tools load on demand. At this phase's entry, load every tool this file names that is not loaded yet with one `ToolSearch` call — `select:` and all their names, comma-separated — never one call per tool, and never a call for a tool already loaded.
{{/harness}}
