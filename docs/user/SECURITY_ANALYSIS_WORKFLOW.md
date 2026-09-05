---
title: 'Security Analysis Workflow'
description: 'How to run security analysis and interpret results to improve your threat models.'
category: 'analysis'
position: 6
navigation: true
tags: ['intermediate', 'guide', 'analysis', 'ai-analysis', 'findings', 'practical', 'workflow']
---

# Security Analysis Workflow

*How to run security analysis and interpret results to improve your threat models.*

## Analysis Overview

Security analysis in Dethernety is provided entirely by modules. The core platform does not ship with built-in analysis logic — instead, modules define what analysis types are available, how they evaluate your model, and what kind of results they produce. This means:

- The analysis types you see depend on which modules are loaded for your model
- Different modules may use different approaches: rule-based (OPA/Rego policies), AI-assisted, or a combination
- Results, severity scales, and recommendation formats vary by module
- You can have multiple analysis types available at once if several modules are loaded

### What the OSS distribution ships

**One analysis type: Threat Report.** It comes from the `dethernety-threat-report` module and is a read-only posture snapshot over an existing model — a set of graph queries, not an AI run. It asks no questions, streams no reasoning, and adds nothing to your model. Its output is the interactive report documented in [Threat Report](threat-report/README.md).

**The `dethernety-general` module contributes no analysis type at all.** Its Rego policies do evaluate your model — that is what derives exposures and countermeasures — but they run against an element's attributes as you configure them, continuously, and surface on the element's **Exposures** tab. That is a different mechanism from an analysis run, and it never appears in the **New Analysis** menu. See [Understanding Security Exposures](COMPONENT_CONFIGURATION_GUIDE.md#understanding-security-exposures).

So on a stock OSS install, the **New Analysis** menu offers exactly one entry. Additional modules add specialized analysis types — compliance checks, framework-specific assessments, AI-assisted evaluation — and everything below that describes AI behaviour applies only when such a module is installed.

**What analysis gives you:**
- Find security issues you might miss in manual review
- Get findings mapped to industry frameworks (MITRE ATT&CK, D3FEND) when the module supports it
- Specific recommendations for addressing findings
- Findings that can be converted into trackable issues

## Running Analysis

### Creating an analysis

1. **Open your model** in the data flow editor (click its tile in the Browser).
2. **Click the sparkle button** on the canvas toolbar — its tooltip reads **Analyses**. The Analyses dialog opens, listing this model's analyses. (The same list is the **Analysis** tab of the Model dialog.)
3. **Click "New Analysis"**. This button *is* the type menu — it opens a list with **one entry per analysis type** your installed modules provide.
4. **Click the type you want.** The analysis is created immediately and appears as a new row.
5. **Click "Run"** in that row to start it.

**You are never asked for a name or a description.** The new analysis takes the analysis type's own name for both — a Threat Report analysis is called *Threat Report*. Renaming is a separate, later step:

- Click the **Name** cell in the row and type over it; press Enter or click away to save.
- Or open the row's **overflow menu** (⋮) and choose **Rename** or **Edit description**.

Do it early. Give the run a name that says what it was for — *Pre-release review, March* — before you accumulate five rows all called *Threat Report*.

### Watching a run

Each row shows a **phase**, not a raw status, and the row's single primary button follows that phase:

| Phase | What it means | Primary button |
|-------|---------------|----------------|
| **Ready** | Created, never run — or run, with no result stored | **Run** |
| **Working** | A run is in progress | **View progress** |
| **Paused** | The run has stopped and is waiting on you | **Answer** (badged) |
| **Done** | A run finished and produced a result | **View results** |
| **Failed** | The run errored — hover the status for the reason | **Retry** |

**Done, not "idle".** A finished analysis reads **Done** and offers **View results**; a never-run one reads **Ready**. Beside the primary button, a **trash** button deletes the analysis — it is hidden while a run is in flight (Working or Paused). The overflow menu adds **Re-run** once an analysis has run at least once.

**Progress and questions are module capabilities.** Clicking **View progress** opens the **Analysis Flow** dialog, which lists the messages the running module streams back, newest first — for an AI module that is its reasoning trail; for a module that streams nothing, it says *Waiting for analysis responses...*. If a module pauses a run to ask you something, the row goes to **Paused** and a question dialog is offered; answering it resumes the run.

Neither surface does anything for the OSS **Threat Report** analysis, which runs to completion without streaming messages or asking questions.

### What modules can offer

What appears in the **New Analysis** menu depends entirely on which modules are installed. A module might provide one analysis type or several:

- Quick vulnerability scans based on component configuration
- AI-assisted threat evaluation with interactive Q&A
- Compliance checks against specific regulatory frameworks
- MITRE ATT&CK mapping and countermeasure recommendations

## Understanding Results

### Result structure

Result format and content depend on the module that runs the analysis. Common elements include:

**Findings:**
- **Severity** -- how the module classifies risk (the scale and labels vary by module)
- **Description** -- what the issue is
- **Impact** -- business and technical consequences
- **Recommendations** -- steps to address the finding

**Framework mappings** (when the module supports it):
- **MITRE ATT&CK** -- attack techniques that could exploit identified issues
- **D3FEND** -- defensive measures that can protect against threats
- **Compliance** -- regulatory requirements related to findings

Some modules also produce a system overview with architecture summaries and data classification before listing findings.

### Working with results

**Review Process:**
1. **Open Results**: Click **View results** in the analysis row (the primary button on a **Done** analysis). The results open on their own page, rendered by the module that produced them.
2. **Priority Review**: Start with highest severity findings
3. **Understand Context**: Review which components and data flows are affected
4. **Plan Response**: Decide on accept, mitigate, transfer, or avoid strategies

**Key Questions to Ask:**
- Which findings require immediate action?
- What findings can be addressed with security controls?
- Are there patterns across multiple findings?
- Which findings align with our compliance requirements?

## Converting Findings to Issues

A module's results view can hand a finding to the platform's issue workflow. What it opens is the same in every module, because the platform owns it.

### Raising a new issue from a finding

1. **Trigger the issue action** on the finding in the results view.
2. A dialog opens, titled **Raise an issue from this finding**, naming the finding underneath.
3. Under *Or create an issue:*, **click an issue class**. The class list is whatever your installed modules provide — on a stock OSS install, the six from `dethernety-general`.
4. The issue is created immediately and its card opens for editing. It is pre-named *`<Finding> Issue on <element>`* and pre-described from the finding's own description.

**What gets linked:** the finding, the element it was raised on, and the model. **Not the analysis run** — nothing records which analysis produced the finding. If that traceability matters, add the analysis by hand from the issue's **Associated Elements** tab.

For the full picture of what each creation path links, see [What actually gets associated](ISSUE_MANAGEMENT_GUIDE.md#what-actually-gets-associated).

**Why raise an issue at all:**
- **Traceability**: a link from the tracked work back to the element and model it concerns
- **Team coordination**: an owner, a severity, and a class-defined lifecycle to work through
- **Progress tracking**: an open/closed board that survives the next analysis run

Issues are tracked entirely within Dethernety; no integration with an external tracker ships with the platform. See [External system integration](ISSUE_MANAGEMENT_GUIDE.md#external-system-integration).

### Adding a finding to an existing issue

The same dialog's **Add to Issue board** button copies the finding to Dethernety's clipboard and sends you to the Issues page:

1. Click **Add to Issue board**. You land on the Issues page.
2. Find the target issue and click its row to expand the card.
3. Click **Add from clipboard**. The finding's elements are linked and a timestamped comment records what was added.
4. Click **Return to `<page>`** to go back to the results.

**The clipboard holds one finding at a time.** Copying a second overwrites the first, so build a multi-finding issue by repeating the loop — copy, paste, return, copy the next — rather than copying several and pasting once. The clipboard also expires after 30 minutes. See [Adding elements to an existing issue](ISSUE_MANAGEMENT_GUIDE.md#adding-elements-to-an-existing-issue).

## Best Practices

### Analysis strategy

**Regular Analysis:**
- Run analysis after significant model changes
- Periodic reviews for ongoing projects
- Before major deployments or releases

**Analysis Selection:**
- If a module offers multiple analysis types, start with lighter assessments for routine checks and use deeper analysis for complex systems or high-risk scenarios
- For compliance requirements, look for modules that provide framework-specific analysis

### Result management

**Prioritization:**
- **Critical/High**: Address immediately, may require stopping deployment
- **Medium**: Include in current development cycle
- **Low**: Plan for future improvement cycles

**Documentation:**
- **Accept decisions**: Document business justification for accepted risks
- **Mitigation plans**: Track implementation of security controls
- **Progress updates**: Regular status updates in issue comments

### Team collaboration

**Analysis Reviews:**
- Include security team in analysis result reviews
- Involve development teams in remediation planning
- Engage compliance teams for regulatory findings

**Communication:**
- Use analysis results to communicate risks to stakeholders
- Convert technical findings into business impact language
- Share analysis reports with relevant teams and management

## Common Analysis Patterns

### New system analysis
```
1. Complete initial model → Run full analysis
2. Review all findings → Create issues for critical/high items
3. Implement controls → Re-run analysis to verify improvements
4. Track remaining issues → Plan ongoing security improvements
```

### Ongoing system analysis
```
1. Model updates → Quick analysis to check new issues
2. Periodic reviews → Full analysis for complete assessment
3. Change impact → Analysis after significant architecture changes
4. Compliance cycles → Specific compliance analysis as required
```

### Pre-deployment analysis
```
1. Final model review → Ensure model reflects current architecture
2. Full analysis → Complete security assessment
3. Critical issue resolution → Must fix before deployment
4. Risk acceptance → Document any accepted risks with justification
```

---

**Next Steps:**
- **[Threat Report](threat-report/README.md)**: Read, filter, and export the OSS analysis type's output
- **[Managing Findings](MANAGING_FINDINGS.md)**: Affirm, dispose, and customize exposures and countermeasures
- **[Working with Security Controls](WORKING_WITH_SECURITY_CONTROLS.md)**: Implement recommended countermeasures
- **[Issue Management Guide](ISSUE_MANAGEMENT_GUIDE.md)**: Track and manage analysis findings
- **[Understanding Modules](UNDERSTANDING_MODULES.md)**: Where analysis types come from