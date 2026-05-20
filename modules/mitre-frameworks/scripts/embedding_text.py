"""
Python mirror of oss/packages/dt-module/src/embedding-text.ts.

Format is pinned: changing it invalidates all stored MITRE vectors and forces a
mitre-frameworks module rebuild + republish.

Task-prefix discipline: build-side prepends 'search_document: '
in the embedding call-site (embedding_provider.py), NOT here, so fixtures stay
prefix-free and remain byte-equal to the TS composer output. Runtime side
prepends 'search_query: ' before embedBatch — see the runtime resolver's
VECTOR_SEARCH_PREFIX constant.

If you edit this, edit oss/packages/dt-module/src/embedding-text.ts in the same
PR — byte-equality is asserted by parallel tests on a
fixture set.
"""

from __future__ import annotations
import re
from typing import Optional

# Same character set as oss/modules/mitre-frameworks/scripts/export_to_cypher.py:normalize_unicode().
# Smart quotes / dashes / ellipses / etc. → ASCII equivalents.
UNICODE_REPLACEMENTS = {
    "‘": "'",
    "’": "'",
    "“": '"',
    "”": '"',
    "–": "-",
    "—": "--",
    "…": "...",
    " ": " ",
    "·": "-",
    "•": "-",
    "­": "",
}


def normalize_for_embedding(s: Optional[str]) -> str:
    """
    Embedding-side normalization for MITRE node text.

    Mirrors the string-handling branch of export_to_cypher.py:escape_cypher_string()
    minus the quote-escaping (the embedded text is never serialized into Cypher).
    Applied to raw STIX/OWL-sourced strings BEFORE compose_*_text so the embedding
    model sees the same content that's already serialised into 01-attack-nodes.cypher
    and 02-defend-nodes.cypher.
    """
    if s is None:
        return ""
    out = s
    for old, new in UNICODE_REPLACEMENTS.items():
        out = out.replace(old, new)
    out = out.replace("\n", " ").replace("\r", " ").replace("\t", " ")
    return out


def compose_technique_text(
    name: str,
    description: Optional[str] = None,
    tactic: Optional[str] = None,
) -> str:
    """
    Build the embedding text for a MITRE technique node (ATT&CK or D3FEND).

    Format byte-equal to TS composeTechniqueText (dt-module/embedding-text.ts).
    """
    return f"{name}. {description or ''}. Tactic: {tactic or 'Unknown'}."


def compose_mitigation_text(
    name: str,
    description: Optional[str] = None,
) -> str:
    """
    Build the embedding text for a MITRE mitigation node.

    Format byte-equal to TS composeMitigationText (dt-module/embedding-text.ts).
    Mitigations have no tactic field — intentionally shorter than the technique variant.
    """
    return f"{name}. {description or ''}."


def slugify_model_name(model: str) -> str:
    """
    Python mirror of slugifyModelName from dt-module/embedding-text.ts. Used by
    the idempotency cache filename so the cache key survives model identifiers
    containing '/' (e.g. 'sentence-transformers/all-MiniLM-L6-v2').

    SECURITY: the regex collapses path-separator characters (/ and \\) and
    whitespace, so no separator survives — the result is always a safe leaf
    filename for `cache_dir / f"{slug}.json"`. Inputs like '../../etc/passwd'
    become '..-..-etc-passwd' (literal dots are allowed) and cannot escape
    the cache directory.
    """
    return re.sub(r"[\/\\\s]+", "-", model)
