---
title: 'Working with Security Controls'
description: 'Learn how to create, manage, and assign reusable security controls in Dethernety to protect your threat models.'
category: 'controls'
position: 7
navigation: true
tags: ['intermediate', 'guide', 'controls', 'browser', 'countermeasures', 'mitre', 'universal-assignment', 'practical']
---

# Working with Security Controls

*Learn how to create, manage, and assign reusable security controls in Dethernety to protect your threat models.*

## Overview: Controls in Dethernety

A **control** is a reusable protective measure that lives in the Browser, independent of any single model, and can be assigned to many elements at once:

- **Create once, use everywhere**: the same control can be assigned to components, data flows, boundaries, and whole models
- **Classes do the work**: a control gets its substance from one or more **control classes** supplied by modules
- **Countermeasures are generated**: configuring an assigned class produces the control's countermeasures, each carrying its MITRE ATT&CK and D3FEND relations
- **Mixed control types**: combine technical, administrative, and process classes in a single control

Two things are worth separating from the start. A control's **countermeasures** are derived from its own classes and attributes — they belong to the control, and they are the same wherever the control is used. What changes with assignment is **which elements the control covers**. See [What assignment means for coverage](#what-assignment-means-for-coverage).

## Creating Security Controls

### Using the Browser Interface

The Browser is your primary interface for creating and managing reusable controls.

**1. Navigate to Browser**:
- Open the **Browser** section in Dethernety
- Use the breadcrumbs at the top to move through folders
- The buttons at the top right of the folder area create, rename, move, and delete folders

**2. Create the control**:
- Click the **+** button at the top right of the models and controls area, then choose the **shield** action — or click the **New control** card in the controls area
- The control is created immediately with a placeholder name, and its **Control** dialog opens

**3. Name and describe it** (General tab):
- Give it a descriptive **Name** (3–100 characters) and a **Description**
- Click **Save** (the save button at the bottom of the dialog). The save button stays disabled until something has changed

**4. Assign control classes** (Control Classes tab):
- Open the **Control Classes** tab and click **+** to open the **Browse classes** drawer
- Search by name or description, and narrow the list with the **Category** and **Module** facet chips
- Click a class to preview it, then click **Select** (or double-click the row) to add it. Classes already on the control show an **Added** chip
- The drawer stays open so you can add several classes in one session — *Adding multiple — use Cancel when done*
- Added classes appear in the bound-class table with their category and source module. Use **Search bound classes** to filter a long list
- Click **Save** to commit the class assignment

**5. Configure each control class**:
- Click the **tune** button on a class row to open its attributes form
- Fill in the attributes the class defines, then **Save**
- **Only configured classes generate countermeasures.** A class's policy fires on the attribute values you set — an unconfigured class contributes nothing
- Attributes are saved by their own form, separately from the control's name, description, and class list

Removing a class that has stored attributes asks for confirmation first: *Removing the following class will delete their stored attributes when you save.* The deletion happens when you save the control, not when you click the trash button.

### Where control classes come from

Control classes are supplied by **modules** — you do not author them in the control dialog. The **Browse classes** drawer lists every control class from every module installed on your Dethernety instance, which is why it offers a **Module** facet. If the class you need doesn't exist, the answer is a module that provides it. See [Understanding Modules](UNDERSTANDING_MODULES.md) for what modules contribute and how they are built.

## Assigning Controls to Elements

### Universal control assignment

A control can be assigned to any element type, from that element's own settings surface. In every case the pattern is the same: a **Controls** tab listing controls, with a checkbox per row.

**From a component, data flow, or security boundary**:
- Double-click the node or the flow arrow on the canvas to open its **settings panel**
- Open the **Controls** tab
- Tick a control's checkbox to assign it — assignment saves immediately, with no separate Save step
- Untick to unassign. This asks first: *Remove control '…' from this element?*
- Click the **shield-plus** button to pull in controls that aren't listed yet; the dialog that opens lists the controls in your Browser folders, and its **+** button creates a new control on the spot
- Click the **pencil** button on a row to open the full **Control** dialog for that control

**From the Model dialog**:
- Right-click a model card in the Browser, or click the **Model settings** icon on the card or on the editor's canvas toolbar
- Open the **Controls** tab and tick the controls that apply model-wide, adding more with the **shield-plus** button
- Unlike the element panel, the model dialog needs an explicit **Save**

The **Classes** column on each row shows which control classes a control carries, so you can tell at a glance whether it will contribute countermeasures.

### What assignment means for coverage

Assignment does not change a control's countermeasures — those are fixed by the control's classes and attributes. Assignment records **which elements the control protects**, and that is what coverage and gap analysis read:

- A control assigned **directly to an element** covers that element.
- A control assigned **to a security boundary** also covers the components that sit directly inside that boundary. Deeper nesting is not credited — a control on a grandparent boundary does not reach a grandchild's components.
- A control assigned **to a model** is recorded against the model. It is a useful statement of a system-wide standard, but it is not counted as covering the model's individual components, flows, and boundaries. Assign it where you want the credit.

So define your security standard once as a control, then assign it wherever it genuinely applies. A single "Encryption Control" can protect a database component, an API data flow, and a network boundary at the same time — it is the same control, with the same countermeasures, credited against three elements.

## What a Countermeasure Carries

Every countermeasure a module generates is more than a sentence of advice: it carries explicit MITRE relations that make it machine-checkable. There are two kinds, and they answer different questions.

### What the countermeasure *is*

Each countermeasure names the ATT&CK **mitigations** it implements and the **D3FEND techniques** it corresponds to. This is the countermeasure's identity in framework terms — for example, an EDR agent countermeasure identifies as *Antivirus/Antimalware (M1049)* and *Behavior Prevention on Endpoint (M1040)* on the ATT&CK side, and *Process Analysis (D3-PA)* on the D3FEND side.

You see these on the **Countermeasures** tab of the control dialog, in the **Mitigations & Techniques** column: blue chips are ATT&CK mitigations, green chips are D3FEND techniques. Click any chip to open its full framework description.

### How the countermeasure *counters*

A countermeasure may also point at specific ATT&CK **techniques** and state what it actually does to each one. The wording is not decoration — each is a different security outcome:

| Relation | What it claims |
|----------|----------------|
| **Mitigates** | Reduces the technique's effectiveness or blast radius. |
| **Protects against** | Hardens the target so the technique does not land in the first place. |
| **Detects** | Surfaces the technique when it is attempted — it does **not** stop it. |
| **Isolates** | Contains the technique by cutting the path it needs. |

This distinction is the whole point. A countermeasure that **detects** *T1078 Valid Accounts* tells you that misuse of a legitimate credential will show up in your telemetry. A countermeasure that **isolates** the same technique tells you the compromised account cannot reach anything worth reaching. Both are "coverage" for T1078; only one of them stops the attack. Collapsing them into a single "covered" flag is exactly the over-claim the platform is built to avoid.

Four further relations — *deceives*, *evicts*, *restores*, and *responds to* — are defined for the full defensive lifecycle. No module shipped today emits them, and nothing surfaces them yet; treat them as reserved.

### Where the relations surface

- **In the control dialog**: the identity chips (mitigations and D3FEND techniques) on each countermeasure row.
- **In the Threat Report**: the technique-level relations drive the **Coverage & Gaps** matrix. A countermeasure that names a technique directly produces the strongest, most specific coverage tier; the `⛉` / `◎` glyphs on a cell come straight from the prevent-versus-detect reading above. See [Understanding Coverage and Gaps](threat-report/UNDERSTANDING_COVERAGE.md).
- **In gap analysis**: for each exposure, the platform walks from the exposure's attack techniques to the ATT&CK mitigations that defend against them, then asks whether any control covering that element provides a countermeasure implementing one of those mitigations. If none does, the exposure is reported as a gap — and controls that *would* address it are recommended.

Because these relations come from the module's policy, you get them without hand-mapping anything. What you *do* control is whether they apply: a class whose attributes you never configured emits no countermeasures, and therefore contributes no coverage.

## Authoring Your Own Countermeasures

Alongside the countermeasures a module generates, you can write your own on any control.

1. Open the control's **Countermeasures** tab and click **+**. The **Add Countermeasure** dialog opens with three tabs on the left.
2. On **Information**, fill in the **Name**, **Description**, **Score**, and **Type**.
3. On **ATT&CK Mitigations**, attach the mitigations this countermeasure implements.
4. On **D3FEND Techniques**, attach the corresponding defensive techniques.
5. Save with the save button at the bottom right.

Both framework tabs use the same [technique picker](#attaching-mitre-techniques-with-the-technique-picker). A hand-authored countermeasure carries the identity relations (mitigations and D3FEND techniques); the technique-level *mitigates / protects against / detects / isolates* relations are emitted by module policies only.

## Attaching MITRE Techniques with the Technique Picker

When you author or edit your own countermeasures and exposures, you can attach MITRE references directly using the **technique picker**:

- **Countermeasures** map to MITRE **D3FEND** techniques and ATT&CK **mitigations**.
- **Exposures** map to MITRE **ATT&CK** techniques.

### Finding the right technique

The picker is built for the reality that you rarely know the exact id. Type into the search box and it matches progressively:

- **By id** — type a full id (`T1003`) or a prefix (`T1003` also surfaces its sub-techniques).
- **By name** — type part of the technique's name (`credential dumping`).
- **By description** — type words that appear in the technique's description.
- **By meaning** — click **Suggest matches** to seed the search from the finding's own description. This uses semantic matching to surface techniques that are conceptually related even when they don't share the exact words.

**Suggest matches** stays disabled until the finding's description is at least 20 characters — the tooltip tells you so. It reads the description only, not the name.

Results show the technique id, name, and tactic. Select a result to see its full description in the **preview** pane before committing, and pick several techniques in one session — the drawer stays open for multi-select. With the search box empty, the dropdown offers **Recently used in this model** to speed up repeat work, and **Browse all →** opens the full drawer.

### When semantic suggestions are unavailable

Semantic ("Suggest matches") results depend on the deployment having an embedding backend configured and the MITRE corpus embedded. If that isn't available, the picker quietly falls back to id, name, and description matching — you can still find and attach any technique; only the meaning-based suggestions are turned off.

## Reviewing a Control's Countermeasures

The **Countermeasures** tab of the control dialog is also where you triage. Each row shows where the countermeasure came from (a provenance icon distinguishes module-generated from your own), and a lifecycle badge showing whether it is awaiting review, confirmed in place, or disposed. The tab label itself carries a count of countermeasures still needing a first look, and a marker when a decision has gone stale because the control's attributes changed underneath it.

From a row you can **affirm** a countermeasure as confirmed in place, **dispose** of it with a reason, or **customize** it as an editable copy you own. Your own countermeasures are edited and deleted directly instead.

That lifecycle is shared with exposures and is documented once, in [Managing Findings](MANAGING_FINDINGS.md).

## Viewing Control Protection

### On the element

Open any component, data flow, or boundary's **settings panel**:

- **Controls tab**: the controls assigned to this element, with the classes each one carries
- **Exposures tab**: the security weaknesses detected on this element, with the ATT&CK techniques that exploit them

Countermeasures are not listed on the element — they belong to the control. Open a control from the **Controls** tab (the pencil button) to see what protection it actually provides.

### Across the model

Element-by-element inspection tells you what is assigned, not what is covered. For the model-wide picture — which techniques your live exposures reach, which controls counter them, how strongly, and where the honest gaps are — use the Threat Report's **Coverage & Gaps** tab. It is the surface that reads the MITRE relations described above, and it deliberately reports coverage tier by tier rather than as a single percentage. See [Understanding Coverage and Gaps](threat-report/UNDERSTANDING_COVERAGE.md).

## Control Management Best Practices

### Organizing controls

**Folder structure in Browser**:
- Create folders by security domain (Network Security, Data Protection, Identity Management)
- Organize by compliance requirements (PCI DSS Controls, GDPR Controls)
- Group by system type (Web Application Controls, Database Controls, Cloud Controls)

Move a control between folders with the **move** button at the bottom of its dialog, and delete it with the trash button next to it. Both are available when you open the control from the Browser.

**Naming conventions**:
- Use descriptive names that indicate purpose ("Web Server Hardening Package")
- Include scope indicators ("Enterprise Network Controls", "Development Environment Controls")
- Controls are not versioned by the platform, so if you need to track revisions, put them in the name ("Payment Processing Controls v2.1")

### Reusing controls across projects

**Control libraries**:
- Keep a folder of standard controls that every model draws from
- One control assigned to many elements means one place to update — improving its class configuration improves every element it covers
- Prefer assigning an existing control over creating a near-duplicate; duplicates fragment your coverage picture

**Best practices**:
- Test controls in development models before production use
- Record implementation notes in the control's description
- Review control configuration when the systems it describes change — attribute changes flag existing countermeasure decisions as stale for re-review
- Track which models use a control before changing it, since the change propagates everywhere

## Common Control Scenarios

### Web application security

**Essential web app control package**:
- **TLS Encryption Control**: Secure communications
- **Input Validation Control**: Prevent injection attacks
- **Authentication Control**: User identity verification
- **Session Management Control**: Secure session handling
- **Security Headers Control**: Browser security policies

### Database protection

**Database security control package**:
- **Database Encryption Control**: Data at rest and in transit
- **Access Control**: Role-based database permissions
- **Audit Logging Control**: Database activity monitoring
- **Backup Security Control**: Secure backup procedures
- **Connection Security Control**: Secure database connections

### Network security

**Network protection control package**:
- **Firewall Control**: Network traffic filtering
- **Network Segmentation Control**: Zone-based security
- **Intrusion Detection Control**: Threat monitoring
- **VPN Control**: Secure remote access
- **DDoS Protection Control**: Attack mitigation

---

**Next Steps:**
- **[Security Analysis Workflow](SECURITY_ANALYSIS_WORKFLOW.md)**: Run analysis to identify where controls are needed
- **[Managing Findings](MANAGING_FINDINGS.md)**: Affirm, dispose, and customize the countermeasures your controls generate
- **[Understanding Coverage and Gaps](threat-report/UNDERSTANDING_COVERAGE.md)**: Read the model-wide coverage matrix your controls feed
- **[Issue Management Guide](ISSUE_MANAGEMENT_GUIDE.md)**: Track control implementation as security improvements
- **[Building Your First Model](BUILDING_YOUR_FIRST_MODEL.md)**: Practical model creation with control assignment
