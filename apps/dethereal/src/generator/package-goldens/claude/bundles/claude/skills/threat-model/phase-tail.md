## Subagent Delegation

- **infrastructure-scout**: Pass the model directory path and the scope summary. It returns the full discovery report — sources checked, the component, boundary and flow tables, the elements with their provenance — and writes nothing: render it whole (see Relay) and persist it as the Discovery Orchestration Protocol says.
- **security-enricher**: Pass the model directory path, the mode (enrichment, classification or control pass) and, for enrichment, the worklist and scope. For enrichment it writes its tables and the questions it could not settle to a relay file and returns the file's path: show the file (Enrichment Relay).
- **enrichment-applier**: Pass the model directory path, the relay files' paths and the operator's reply to the relay, verbatim. It writes what the reply decides into the attribute files and returns a table of what it wrote, with the follow-ups: print it (Enrichment Relay).
- **model-reviewer**: Pass the model directory path. It returns the full review (gate verdicts from the validation tool, top issues, zoning findings) and writes nothing: render it whole (see Relay).

Pass directory paths, not serialized model content. Each subagent reads current state from disk independently. Each one starts without this conversation, so the prompt you give it must carry everything it needs: the model path, the scope summary, the mode.

## Relay

A specialist agent proposes; this conversation shows, asks and writes.

- **Show what it returned, by table kind.** Put the agent's tables and findings in the conversation as markdown before the gate that follows them, and never let a question's options carry information the tables do not show. Each table is one of three kinds:
  - **Confirm** — the answer writes values: every row and every value it writes, never capped or folded, each with its basis (`[cited]`, `[derived: <setting> → <behaviour>]`, `[env: dev]`, `[answer]`), in pages of at most 50 rows; "accept all" covers only the rows in that message. The enrichment relay is the exception: its whole relay file is one message (Enrichment Relay).
  - **Collect** — the operator supplies values: at most 15 subjects per table. Rows with nothing known — no pre-fill, citation or divergence — fold into one line that keeps their ids and names ("No credential seen in the repo (12): F5 API→Cache, F6 …"), and say once that a field left empty may make exposures inaccurate. A pre-filled cell never folds.
  - **Display** — the answer picks a direction and writes nothing: at most 10 rows per group, then `+N more — details <group>`.
  - **Findings never fold** and never count toward a cap: contradictions, claim-vs-evidence and source-vs-source rows, changes to existing values, red flags, proposed defaults and derived or dev values, rows newly failing a gate, lapsed waivers, crown-jewel rows and unmatched jewels.
- **Details on request.** A row's evidence and rationale (`path:line`, the class guide, other candidates) may wait behind `details <id>` — never a value a question confirms. Say it once above the question: "Details: say `details <id>` — this answers nothing; I'll ask again." `details` is not an answer: show the details, then ask the same question again, starting with the same tag. A reply that mixes answers and `details` applies nothing and is asked again. Ids stay stable within a step: flows `F#`, divergence rows `D#`, questions `Q#`, written values `R#`, claims `C#`.
- **Its results are proposals.** Nothing an agent returns is confirmed until the operator answers the gate. Never mark its work as reviewed, never transition state on its word, and never fill in what it left out.
- **Check what it cites.** Before relaying, scan the returned descriptions for credential material (`password=`, base64 blocks, token-shaped strings, key prefixes) and replace any match with `[REDACTED]`.
- **Write after the reply.** Once the operator has answered, write what they confirmed — and only that — then validate. The one exception is the enrichment agent, which writes cited and derived values into empty attribute fields; the enrichment relay shows every one of them, and the operator's reply keeps, reverts or changes them.
- **An agent that stopped with a question.** If its final message is a `[prompt: <id>]` question, put that question to the operator exactly as written; do not answer it yourself. Then start the agent again with the operator's reply quoted verbatim, tagged `[answer: <id>]`.

## Question groups

Where a phase names a group, its questions are one `AskUserQuestion` dialog — the one exception to one question at a time:

- **Before it:** every member's table, tree or list, in your message.
- **Each member** is one question: its tag first, then its text as written — a repeated tag made distinct by the subject it names, such as a document's path — with 2–4 options from its choices — no multiSelect, no preview. A free-text member's options are `none` and `not sure` — never one that accepts what a table shows; the rest the operator types. A member's own cue ("a plain message", "in one message") gives way to the dialog.
- **Size:** at most 800 characters a question as filled in, and 2,400 for the dialog; past either, ask the members one at a time.
- **A member** whose condition does not hold is left out; one left alone is asked as usual.
- **The answers** are applied in the members' order. An unanswered member stops it there: ask that member again, alone, and apply the later answers only after it is answered. An answer that changes what another member shows or asks about has that member asked again, alone. A dialog dismissed with no answers is asked again one member at a time, each alone.
