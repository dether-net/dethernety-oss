## Subagent Delegation

- **infrastructure-scout**: Pass the model directory path and the scope summary. It returns the full discovery report — sources checked, the component, boundary and flow tables, the elements with their provenance — and writes nothing: render it whole (see Relay) and persist it as the Discovery Orchestration Protocol says.
- **security-enricher**: Pass the model directory path, the mode (enrichment, classification or control pass) and, for enrichment, the worklist and scope. For enrichment it writes its tables and the questions it could not settle to a relay file and returns the file's path: show the file (Enrichment Relay).
- **enrichment-applier**: Pass the model directory path, the relay files' paths and the operator's reply to the relay, verbatim. It writes what the reply decides into the attribute files and returns a table of what it wrote, with the follow-ups: print it (Enrichment Relay).
- **model-reviewer**: Pass the model directory path. It returns the full review (gate verdicts from the validation tool, top issues, zoning findings) and writes nothing: render it whole (see Relay).

Pass directory paths, not serialized model content. Each subagent reads current state from disk independently. Each one starts without this conversation, so the prompt you give it must carry everything it needs: the model path, the scope summary, the mode.
