Collect the scope in conversation, not as a form; take what the operator already said and ask only for the rest:

| Field | Required | Default | Guidance |
|-------|----------|---------|----------|
| `system_name` | yes | — | From the description, or ask |
| `description` | yes | — | 1–2 sentence architecture summary |
| `depth` | no | `architecture` | architecture, design, implementation |
| `modeling_intent` | no | `initial` | initial, security_review, compliance, incident_response |
| `compliance_drivers` | no | `[]` | Any compliance requirements? |
| `crown_jewels` | yes (≥ 1) | — | The most valuable assets |
| `exclusions` | no | `[]` | Anything explicitly out of scope. An exclusion removes what a provider runs inside a service, never the service the system uses: a managed database, cluster or queue the system stores in or runs on stays a component, in scope; only its provider-side internals are out of scope. When an exclusion could mean either, keep the service and say so. |
| `trust_assumptions` | no | `[]` | What is explicitly trusted |
| `adversary_classes` | no | — | Asked for every intent; the enrichment questions depend on them. Write the ids `external`, `insider`, `supply_chain`, and others as the operator names them |

{{#ask id=scope text}}To scope the model: the system's name and a one-line description, if you have not given them. What are the most valuable assets in this system (crown jewels)? What do you explicitly trust? Which adversary classes should it consider (external, insider, supply_chain, others)? Anything out of scope? Any compliance requirements, and the depth and intent if not the defaults?{{/ask}}

Then scaffold the model at `./threat-models/<kebab-case-name>/` unless the operator named a path:

| File | Content |
|------|---------|
| `manifest.json` (first: the state is kept only inside a model directory) | `{ schemaVersion, format: "split", model: { id: null, name, description, defaultBoundaryId }, files: { structure, dataFlows, dataItems, attributes }, modules: [] }` per the File Format — `modules` stays `[]`: the server fills it from the active modules and the classes used (in memory for the gates; a push writes it), so never write or ask for module references |
| `structure.json` | the default boundary, no children yet |
| `dataflows.json` | `[]` |
| `data-items.json` | `[]` |
| `.dethereal/scope.json` | the scope from this step |

Then {{tool:model_state}} `get` and `action: 'transition'`, `to: 'SCOPE_DEFINED'`: this first transition also registers the model in `.dethernety/models.json`. Never write the registry by hand; when the result says `registered: false`, show its warning and go on. Never call {{tool:create_threat_model}} here: publishing needs the platform and happens when the model is pushed.
