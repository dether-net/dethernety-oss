## Enrichment Questions

**Adversary-driven questions.** Echo the trust assumptions once. When `insider` is declared (never skipped):

{{#ask id=admin-access-paths text}}For each element: who can reach it administratively, and how (SSH, RDP, bastion, console, break-glass account)? Say "none" where there is no such path.{{/ask}}

When `supply_chain` is declared (never skipped):

{{#ask id=supply-chain text}}Which CI/CD system builds and deploys this, with which credentials, and which registries does it use — and who can push to them?{{/ask}}

**The question tables.** What the operator still has to answer is shown as tables, each under its heading, with its header written exactly as below; a table with no rows is left out. Each table has its own question (this skill's own questions). An open cell of the Credentials or Boundary enforcement table is asked there, never again as an Open fields row; so a batch's Open fields leave out the credential keys, `auth_failure_mode` and the boundary enforcement keys, which come after the data items. At most 15 subjects per table in one showing (Relay); the rest go on the next page.

{{include shared/enrichment-tables.md}}

**The Credential mapping question.** The mapping follows the credential answers:

{{#ask id=credential-mapping}}Apply this credential mapping? (apply / modify){{/ask}}

**Documentation claims.** Per document with claims, show its rows — element, field by its exact template key, value, line — then ask:

{{#ask id=claim-confirm}}Does this document describe the deployed system? On yes, the values shown are written citing it; on no, they stay unknown. (yes / no / some rows){{/ask}}

On `yes`, write the rows with your edit tool, citing the document; on `some rows`, only the rows the operator names; on `no`, nothing.

{{include shared/data-item-gates.md}}
