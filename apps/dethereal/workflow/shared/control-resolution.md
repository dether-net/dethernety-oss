## Control references

A push links every `controls[]` entry to a Control in the organisation's catalog before it writes anything. An entry with an `id` links to that id only. An entry with no id links to the Control whose name is the same — exact after Unicode normalisation (NFC), with invisible default-ignorable characters removed and spaces trimmed; never a case-insensitive or partial match. When an entry cannot be linked, the push is refused.

**Greenfield entries are deferred.** An entry whose id is a greenfield temporary id (`greenfield-…`) is not linked, refused or warned about by the model push: it never appears in `control_errors`. The model push goes first; the control library's greenfield push then creates the Control and links the entry. An entry whose greenfield push failed before its id was rewritten stays deferred until that push runs again.

**The refusal.** "Control references could not be resolved; nothing was pushed", or "Element ids must be unique in the model; nothing was pushed" — its `data` holds `codes` and `control_errors`, one per entry, at most 100 (`control_errors_total`, when present, is the whole count): `code`, `ref` (an element id, `@model` for the model's own controls, or `<group>[<n>]` for an element that has no id yet), `index` (its position in that `controls` list; absent when the element's `controls` is not a list at all), `control` (`id`, `name`), and `candidates` (`id`, `name`) with `candidates_total` when catalog Controls carry the entry's name. When the refusal does not say nothing was pushed, a model may already exist: show the error as it is and stop.

- `control_catalog_unavailable` — the catalog could not be read: nothing was pushed. Say so, and stop; the push can be tried again later.
- `duplicate_element_id` — two elements share an id, or an id equals `@model` or a `<group>[<n>]` reference: name them and stop. The ids are fixed in the model files first.

Otherwise, show every entry as one table — `C# | element (or the model) | entry (name, id) | problem | candidates` — the candidates by number with their ids, `+N more` past the listed ones; with `control_errors_total`, say how many more entries wait (that total minus the rows shown): they come back on the next push:

- `control_name_ambiguous` — several Controls have this name;
- `control_name_not_found` — no Control has this name;
- `control_id_not_found` — the linked Control is gone from the catalog (exact-name candidates, if any);
- `control_entry_invalid` — the entry has neither an id nor a name, or the element's `controls` is not a list.

Then ask:

{{#ask id=control-resolve text}}For each row, give a candidate's number, `create` (a new Control in the catalog, under this name), `remove` (drop the entry from its element), or the exact name of another Control. Every row needs an answer; `not now` cancels the push.{{/ask}}

Never pick for the operator, never remove, rename or strip a control to get a push through, and never push again while a row is unanswered. `not now` stops: nothing is pushed. In the guided workflow, go on as after a consent `skip`.

**Writing the answers**, with your edit tool, into the entry at `ref` and `index`. `@model` is `manifest.json`'s `model.controls`; an element id is that element's `controls`; `<group>[<n>]` is the element at position `n` (from 0) of its group, counted in this order: the boundaries and components of `structure.json` from the root boundary down — a boundary, then its components, then its child boundaries — then the data flows of `dataflows.json`, then the data items of `data-items.json`, each in list order. A data item id is that item's `controls` in `data-items.json`. Then:

- a candidate, or another Control by name — its `id` and its catalog `name`;
- `create` — {{tool:manage_controls}} `create` under the entry's name (it asks the operator's approval), then the new Control's `id`;
- `remove` — the entry leaves its `controls` list.

**Changed controls.** Every entry changed this way was written from the operator's answer: show the changed `controls` lists in one table, then push again. An entry whose id `clear ids` cleared after a push is shown the same way, with no push: the next push links it again by name.

**After a push.** A warning that an entry's linked Control has another name in the catalog than the entry holds means a stale id may link a different Control: show the entry and both names.
