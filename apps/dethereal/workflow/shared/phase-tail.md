{{include shared/delegation.md}}

{{include shared/relay.md}}
{{#harness claude}}

## Question groups

Where a phase names a group, its questions are one `AskUserQuestion` dialog — the one exception to one question at a time:

- **Before it:** every member's table, tree or list, in your message.
- **Each member** is one question: its tag first, then its text as written — a repeated tag made distinct by the subject it names, such as a document's path — with 2–4 options from its choices — no multiSelect, no preview. A free-text member's options are `none` and `not sure` — never one that accepts what a table shows; the rest the operator types. A member's own cue ("a plain message", "in one message") gives way to the dialog.
- **Size:** at most 800 characters a question as filled in, and 2,400 for the dialog; past either, ask the members one at a time.
- **A member** whose condition does not hold is left out; one left alone is asked as usual.
- **The answers** are applied in the members' order. An unanswered member stops it there: ask that member again, alone, and apply the later answers only after it is answered. An answer that changes what another member shows or asks about has that member asked again, alone. A dialog dismissed with no answers is asked again one member at a time, each alone.
{{/harness}}
