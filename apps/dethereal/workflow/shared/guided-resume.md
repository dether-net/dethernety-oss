### Resume

On invocation, call {{tool:model_state}} with `action: 'get'` to find the current position. **Before** computing the step cursor, run the Drift Orchestration Protocol — drift logic slots between reading the state and computing the cursor. Then compute the step cursor from the state and the steps already done. Show a progress table with the `display_state` (Resuming a model), then ask:

{{#ask id=resume-cursor}}Continue from Step N, or jump to a step? (continue / a step number){{/ask}}
