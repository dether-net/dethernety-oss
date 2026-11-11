1. If `.dethereal/scope.json` has no `crown_jewels`, an empty list, or no `adversary_classes` field, ask. An explicit empty `adversary_classes` list, or `none`, is an answer — never ask it again:

   {{#ask id=scope-crown-jewels text}}What are the most valuable assets in this system — its crown jewels — and which adversary classes should this model consider (external, insider, supply_chain, others)?{{/ask}}

   Write the answer to the scope's `crown_jewels` and `adversary_classes` (as those ids), keeping the rest of the scope.
2. Propose the mapping: each crown jewel to the elements that hold it, starting from components already marked `crownJewel: true`, then names that match — a component, else a data item, with the stores that hold it. Show it as a confirm table (jewel, element, type; the why behind `details`) with a row for every crown jewel of the scope — one that matches nothing is a row too, marked unmatched: it stays unmapped, and Gate 3's C6 fails, until its element is added ({{cmd:add}}). Then ask:

   {{#ask id=crown-jewel-confirm}}Confirm this crown-jewel mapping, or adjust specific rows? (confirm / adjust){{/ask}}

3. Write only what was confirmed, with your edit tool, in one message: `crownJewel: true` on each mapped component in `structure.json`, and `crown_jewel_elements` in the scope — each `crown_jewels` entry, verbatim, mapped to its element ids. At least one mapped element is a non-external component. Validate.
