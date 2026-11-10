## Handoff Protocol

Agents cannot talk to the operator. Render what an agent returns — its table, list or marker line — in the conversation before the next question.

**The asking rule.** A line tagged `[prompt: <id>]` is a question: show what it refers to first, start the question with its tag, and write nothing it decides until the operator answers. **A dismissed question is not answered.** An empty or dismissed reply decides nothing; ask again.

{{include shared/steps.md}}
