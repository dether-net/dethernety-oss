## Control Pass — Operator Questions

### Enforcement controls

A model with no boundaries:

{{#ask id=controls-global-enforcement text}}What enforcement controls protect this system? (Firewalls, WAFs, IDS/IPS, network access controls, or "none"){{/ask}}

More than six boundaries without enforcement controls:

{{#ask id=controls-large-model}}N boundaries have no enforcement controls. Review: (1) crown-jewel boundaries only, (2) all boundaries, (3) skip.{{/ask}}

Each boundary with a pre-ranked table:

{{#ask id=controls-boundary-confirm}}Assign the controls marked Y for [Boundary Name]? (assign as marked / change marks / skip){{/ask}}

{{#ask id=controls-boundary-additional text}}Additional controls not in your library? (describe or "none"){{/ask}}

Each boundary with a greenfield table (no candidates, or the platform unreachable), with the ControlClasses proposed for classed elements:

{{#ask id=controls-boundary-bindings}}Assign the proposed controls and ControlClass bindings for [Boundary Name]? (assign / change / skip){{/ask}}

{{#ask id=controls-boundary-new text}}Enter any other enforcement controls for [Boundary Name], or "none" to skip.{{/ask}}

After the crown-jewel boundaries, when others remain:

{{#ask id=controls-continue}}Continue with the remaining N boundaries? (continue / stop){{/ask}}

Each crown-jewel component, with the proposed component-scoped control or why boundary-level protection suffices:

{{#ask id=controls-crown-jewel-sweep}}[Component] is a crown jewel. Assign the proposed component-scoped control, or record the reason instead? (assign / record reason / change){{/ask}}

### Detection controls

{{#ask id=controls-detection}}Assign the monitoring tools marked Y as detection controls? (assign as marked / change marks){{/ask}}

{{#ask id=controls-detection-additional text}}Additional detection controls? (SOC monitoring, NDR, automated response, or "none"){{/ask}}

### Governance

{{#ask id=controls-governance text}}Any governance controls to record — patch management, access reviews, change control, incident response? Describe them, or "none".{{/ask}}

### Re-runs

A boundary that already has controls shows them as "currently assigned" first:

{{#ask id=controls-rerun}}Add more controls or modify? (add / modify / skip){{/ask}}

New controls are additive: remove an existing control only when the operator asks.
