## Model Resolution Protocol

A `directory-path` argument is used directly. Otherwise, if `.dethernety/models.json` lists exactly one model, use it implicitly; with several, show them as a numbered list (name, path, and `display_state` from {{tool:model_state}} `get`), then ask:

{{#ask id=model-select text}}Which model? (the number from the list, or a path){{/ask}}

With none, suggest {{cmd:create}}. Read model files from disk at the start of each operation, never from memory.
