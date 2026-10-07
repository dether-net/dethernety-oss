#!/usr/bin/env python3
"""
Export MITRE ATT&CK, ATLAS and D3FEND data from Memgraph to Cypher files.

Generates MERGE statements with appropriate unique identifiers for upsert behavior:
- ATT&CK nodes: MERGE on attack_id
- ATLAS nodes: MERGE on atlas_id
- D3FEND techniques/tactics: MERGE on d3fendId (uri where a node has none)
- D3FEND entities: MERGE on uri

Each framework writes its own files, and ATLAS's sort after ATT&CK's and D3FEND's, so
every loader (which replays data/*.cypher in file-name order) has the nodes before the
edges that reference them:
  01-attack-nodes   02-defend-nodes   03-relationships (ATT&CK and D3FEND)
  06-atlas-nodes    07-atlas-relationships    08-atlas-crosswalk (ATLAS -> ATT&CK)

The exporter fails instead of guessing: a node must carry exactly one mapped label and
its key, and a relationship may only cross frameworks where the data model allows it.
"""

import os
import sys
import argparse
import json
from pathlib import Path
from typing import Dict, Iterable, List, Any, Tuple
from neo4j import GraphDatabase

sys.path.insert(0, str(Path(__file__).resolve().parent))
from atlas_stix import CROSSWALK_EDGE_TYPE, TECHNIQUE_LABEL as ATLAS_TECHNIQUE_LABEL  # noqa: E402

# Environment variables
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USERNAME", "neo4j")
NEO4J_PASS = os.getenv("NEO4J_PASSWORD", "password")

# Export wall-clock stamps written by the ontolocy loader. Dropped from the emitted
# relationships: nothing reads them (the ontology fingerprint excludes them for cause,
# precisely because they are ingest wall-clock), and they are what made a regenerated
# pack create parallel edges instead of matching the existing ones.
PROVENANCE_PROPS = {"ontolocy_created", "ontolocy_merged"}

# Label configurations with their unique key properties
ATTACK_LABELS = {
    "MitreAttackTactic": "attack_id",
    "MitreAttackTechnique": "attack_id",
    "MitreAttackGroup": "attack_id",
    "MitreAttackSoftware": "attack_id",
    "MitreAttackMitigation": "attack_id",
    "MitreAttackCampaign": "attack_id",
    "MitreAttackDataSource": "attack_id",
    "MitreAttackDataComponent": "attack_id",
}

DEFEND_LABELS = {
    "MitreDefendTactic": "d3fendId",
    "MitreDefendTechnique": "d3fendId",
    # Entity types use uri as the unique key
    "MitreDefendProcessEntity": "uri",
    "MitreDefendStorageEntity": "uri",
    "MitreDefendDigitalEventEntity": "uri",
    "MitreDefendSensorEntity": "uri",
    "MitreDefendNetworkNodeEntity": "uri",
    "MitreDefendLinkEntity": "uri",
    "MitreDefendNetworkTrafficEntity": "uri",
    "MitreDefendSystemCallEntity": "uri",
    "MitreDefendOSAPIFunctionEntity": "uri",
    "MitreDefendSubroutineEntity": "uri",
    "MitreDefendFirmwareEntity": "uri",
    "MitreDefendUserAccountEntity": "uri",
    "MitreDefendCredentialEntity": "uri",
    "MitreDefendHardwareDeviceEntity": "uri",
    "MitreDefendSoftwareEntity": "uri",
    "MitreDefendFileEntity": "uri",
    "MitreDefendResourceEntity": "uri",
    "MitreDefendDigitalInformationBearerEntity": "uri",
    "MitreDefendDigitalInformationEntity": "uri",
    "MitreDefendDigitalArtifactEntity": "uri",
}


ATLAS_LABELS = {
    "MitreAtlasTechnique": "atlas_id",
    "MitreAtlasTactic": "atlas_id",
    "MitreAtlasMitigation": "atlas_id",
    "MitreAtlasCaseStudy": "atlas_id",
}

FRAMEWORK_LABELS = {"attack": ATTACK_LABELS, "defend": DEFEND_LABELS, "atlas": ATLAS_LABELS}
LABEL_KEYS = {label: key for labels in FRAMEWORK_LABELS.values() for label, key in labels.items()}
LABEL_FRAMEWORK = {label: fw for fw, labels in FRAMEWORK_LABELS.items() for label in labels}

# A D3FEND technique or tactic without a d3fendId is keyed on its uri, like the D3FEND
# entities. The one declared second key; every other missing key is an error.
FALLBACK_KEYS = {label: "uri" for label in DEFEND_LABELS}

# The intra-framework structure types ATLAS reuses from ATT&CK. A cross-framework edge of
# one of these types would merge two frameworks' hierarchies, so it never exports.
STRUCTURAL_TYPES = {
    "SUBTECHNIQUE_OF",
    "TACTIC_INCLUDES_TECHNIQUE",
    "MITIGATION_DEFENDS_AGAINST_TECHNIQUE",
    "CAMPAIGN_USES_TECHNIQUE",
}

# Labels the ingest creates that are deliberately not exported. ontolocy writes one
# MitreAttackMatrix node with MITRE_MATRIX_INCLUDES_TACTIC edges; the matrix order it
# carries is stamped on each tactic as matrix_order at ingest, so the node adds nothing.
# Its edges are skipped by name and counted, never keyed by a guessed property.
EXCLUDED_LABELS = {"MitreAttackMatrix"}

NODE_FILES = {
    "attack": "01-attack-nodes.cypher",
    "defend": "02-defend-nodes.cypher",
    "atlas": "06-atlas-nodes.cypher",
}
# Relationship bucket -> file. ATT&CK <-> D3FEND edges stay in 03, as they always have.
RELATIONSHIP_FILES = {
    "attack-defend": "03-relationships.cypher",
    "atlas": "07-atlas-relationships.cypher",
    "crosswalk": "08-atlas-crosswalk.cypher",
}
FRAMEWORK_SELECTIONS = {
    "all": (["attack", "defend", "atlas"], ["attack-defend", "atlas", "crosswalk"]),
    "atlas": (["atlas"], ["atlas", "crosswalk"]),
}


class ExportError(Exception):
    """The graph holds something the exporter has no correct way to write."""


NodeIdentity = Tuple[str, str, Any]  # (label, key property, key value)


def node_identity(labels: Iterable[str], props: Dict[str, Any]) -> NodeIdentity:
    """The node's one mapped label and the key it MERGEs on. Raises rather than guessing."""
    labels = sorted(labels)
    mapped = [label for label in labels if label in LABEL_KEYS]
    if len(mapped) != 1:
        raise ExportError(
            f"node {props.get('name')!r} carries {len(mapped)} mapped MITRE labels: {labels}"
        )
    label = mapped[0]
    key = LABEL_KEYS[label]
    value = props.get(key)
    if value is None and label in FALLBACK_KEYS:
        key = FALLBACK_KEYS[label]
        value = props.get(key)
    if value is None:
        raise ExportError(f"{label} node {props.get('name')!r} has no {key}")
    return label, key, value


def is_excluded(source_labels: Iterable[str], target_labels: Iterable[str]) -> bool:
    """True for an edge with an endpoint the export leaves out on purpose."""
    return bool(EXCLUDED_LABELS & (set(source_labels) | set(target_labels)))


def route_relationship(
    rel_type: str, source: NodeIdentity, target: NodeIdentity
) -> str:
    """The relationship file bucket for an edge, or ExportError for an edge that must not exist."""
    source_fw = LABEL_FRAMEWORK[source[0]]
    target_fw = LABEL_FRAMEWORK[target[0]]
    if rel_type == CROSSWALK_EDGE_TYPE:
        if source[0] != ATLAS_TECHNIQUE_LABEL or target[0] != "MitreAttackTechnique":
            raise ExportError(
                f"{rel_type} from {source[0]} {source[2]} to {target[0]} {target[2]}: "
                f"the crosswalk links an ATLAS technique to an ATT&CK technique only"
            )
        return "crosswalk"
    if source_fw == target_fw:
        return "atlas" if source_fw == "atlas" else "attack-defend"
    if "atlas" in (source_fw, target_fw):
        raise ExportError(
            f"{rel_type} from {source[0]} {source[2]} to {target[0]} {target[2]}: ATLAS links "
            f"to another framework only through {CROSSWALK_EDGE_TYPE}"
        )
    if rel_type in STRUCTURAL_TYPES:
        raise ExportError(
            f"cross-framework {rel_type} from {source[0]} {source[2]} to {target[0]} {target[2]}"
        )
    return "attack-defend"


def normalize_unicode(s: str) -> str:
    """Normalize Unicode characters to ASCII equivalents for Memgraph compatibility."""
    replacements = {
        '\u2018': "'",   # Left single quote
        '\u2019': "'",   # Right single quote
        '\u201C': '"',   # Left double quote
        '\u201D': '"',   # Right double quote
        '\u2013': '-',   # En dash
        '\u2014': '--',  # Em dash
        '\u2026': '...', # Ellipsis
        '\u00A0': ' ',   # Non-breaking space
        '\u00B7': '-',   # Middle dot
        '\u2022': '-',   # Bullet
        '\u00AD': '',    # Soft hyphen
    }
    for old, new in replacements.items():
        s = s.replace(old, new)
    return s


def escape_cypher_string(value: Any) -> str:
    """Escape a value for use in Cypher.

    Uses double-quoted strings for Memgraph compatibility.
    Memgraph has stricter parsing than Neo4j for escape sequences.
    """
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        escaped_items = [escape_cypher_string(item) for item in value]
        return "[" + ", ".join(escaped_items) + "]"
    if isinstance(value, dict):
        return '"' + json.dumps(value).replace('"', '\\"') + '"'
    # String - normalize unicode and use double-quoted strings for Memgraph
    s = str(value)
    s = normalize_unicode(s)
    # For double-quoted strings: escape backslashes and double quotes
    s = s.replace("\\", "\\\\")
    s = s.replace('"', '\\"')
    # Replace newlines/tabs with spaces for Memgraph compatibility
    s = s.replace("\n", " ")
    s = s.replace("\r", " ")
    s = s.replace("\t", " ")
    return f'"{s}"'


def format_properties(props: Dict[str, Any], exclude_keys: List[str] = None) -> str:
    """Format properties for SET clause, excluding specified keys."""
    exclude_keys = exclude_keys or []
    parts = []
    for key, value in props.items():
        if key in exclude_keys or value is None:
            continue
        parts.append(f"n.{key} = {escape_cypher_string(value)}")
    return ", ".join(parts)



def export_nodes(driver, label: str, output_file) -> int:
    """Export nodes for a label with MERGE statements, ordered by key."""
    rows = []
    with driver.session() as session:
        for record in session.run(f"MATCH (n:{label}) RETURN n"):
            node = record["n"]
            props = dict(node)
            _, unique_key_used, key_value = node_identity(node.labels, props)
            rows.append((unique_key_used, str(key_value), key_value, props))
    rows.sort(key=lambda row: (row[0], row[1]))

    for unique_key_used, _, key_value, props in rows:
        # Build MERGE statement
        merge_key = escape_cypher_string(key_value)

        # Properties to set (exclude the unique key since it's in MERGE)
        set_props = format_properties(props, exclude_keys=[unique_key_used, 'id'])

        # Generate Cypher
        output_file.write(f"MERGE (n:{label} {{{unique_key_used}: {merge_key}}})\n")
        output_file.write(f"ON CREATE SET n.id = randomUUID()\n")
        if set_props:
            output_file.write(f"SET {set_props};\n")
        else:
            output_file.write(";\n")
        output_file.write("\n")

    return len(rows)


def write_relationship(
    output_file, rel_type: str, source: NodeIdentity, target: NodeIdentity, durable_props: Dict[str, Any]
) -> None:
    source_label, source_key, source_key_value = source
    target_label, target_key, target_key_value = target
    source_match = escape_cypher_string(source_key_value)
    target_match = escape_cypher_string(target_key_value)

    output_file.write(f"MATCH (s:{source_label} {{{source_key}: {source_match}}})\n")
    output_file.write(f"MATCH (t:{target_label} {{{target_key}: {target_match}}})\n")

    # A relationship MERGE matches on the whole pattern, so a property inside
    # the pattern becomes part of the edge's identity. That is legitimate for a
    # DETERMINISTIC key meant to serve as that identity (elsewhere in the
    # platform a merge_key is used exactly that way), and fatal for anything
    # that varies between runs.
    #
    # The ontolocy_* stamps are export wall-clock, so they varied on every run:
    # a regenerated pack matched nothing and created a PARALLEL edge for every
    # relationship already ingested, doubling the corpus. No engine-level
    # constraint can catch that — neither Memgraph nor Neo4j can express
    # endpoint-pair relationship uniqueness.
    #
    # Nothing here needs an identity beyond endpoints + type, so: MERGE on those
    # alone, and write any durable property with a SET afterwards. This mirrors
    # the node emission above, which has always keyed its MERGE on the
    # identifier and SET the rest.
    output_file.write(f"MERGE (s)-[r:{rel_type}]->(t)\n" if durable_props
                      else f"MERGE (s)-[:{rel_type}]->(t);\n")

    if durable_props:
        set_str = ", ".join(
            f"r.{k} = {escape_cypher_string(v)}"
            for k, v in durable_props.items()
        )
        output_file.write(f"SET {set_str};\n")

    output_file.write("\n")


def export_relationships(driver, output_files: Dict[str, Any]) -> Dict[str, int]:
    """
    Export relationships between MITRE nodes into their framework's file, ordered by
    type and endpoint keys. Every edge is identified and routed, including those of a
    framework not being written, so a malformed edge fails the export whatever is selected.
    """
    buckets: Dict[str, List[Tuple[Any, ...]]] = {bucket: [] for bucket in RELATIONSHIP_FILES}

    with driver.session() as session:
        # Get all relationships involving MITRE nodes
        query = """
        MATCH (s)-[r]->(t)
        WHERE any(label IN labels(s) WHERE label STARTS WITH 'Mitre')
          AND any(label IN labels(t) WHERE label STARTS WITH 'Mitre')
        RETURN s, type(r) AS rel_type, properties(r) AS rel_props, t
        """
        skipped = 0
        for record in session.run(query):
            if is_excluded(record["s"].labels, record["t"].labels):
                skipped += 1
                continue
            source = node_identity(record["s"].labels, dict(record["s"]))
            target = node_identity(record["t"].labels, dict(record["t"]))
            rel_type = record["rel_type"]
            bucket = route_relationship(rel_type, source, target)
            durable_props = {
                k: v
                for k, v in sorted((record["rel_props"] or {}).items())
                if v is not None and k not in PROVENANCE_PROPS
            }
            sort_key = (
                rel_type,
                source[0], str(source[2]),
                target[0], str(target[2]),
                json.dumps(durable_props, sort_keys=True, default=str),
            )
            buckets[bucket].append((sort_key, rel_type, source, target, durable_props))

    if skipped:
        print(f"  skipped {skipped} relationships of excluded labels {sorted(EXCLUDED_LABELS)}")
    counts = {}
    for bucket, output_file in output_files.items():
        rows = sorted(buckets[bucket], key=lambda row: row[0])
        for _, rel_type, source, target, durable_props in rows:
            write_relationship(output_file, rel_type, source, target, durable_props)
        counts[bucket] = len(rows)
    return counts


def main():
    parser = argparse.ArgumentParser(
        description="Export MITRE ATT&CK, ATLAS and D3FEND data to Cypher files"
    )
    parser.add_argument(
        "--output-dir",
        default="./data",
        help="Output directory for Cypher files"
    )
    parser.add_argument(
        "--frameworks",
        choices=sorted(FRAMEWORK_SELECTIONS),
        default="all",
        help="Files to write: all, or atlas (06-08 only, leaving the ATT&CK and D3FEND files untouched)",
    )
    args = parser.parse_args()
    frameworks, relationship_buckets = FRAMEWORK_SELECTIONS[args.frameworks]

    # Create output directory
    os.makedirs(args.output_dir, exist_ok=True)

    # Connect to database
    print(f"Connecting to {NEO4J_URI}...")
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASS))

    try:
        node_counts = {}
        for framework in frameworks:
            path = os.path.join(args.output_dir, NODE_FILES[framework])
            print(f"Exporting {framework} nodes to {path}...")
            total = 0
            with open(path, "w") as f:
                # Note: No comments - Memgraph mgconsole doesn't handle // comments when piped via stdin
                for label in FRAMEWORK_LABELS[framework]:
                    count = export_nodes(driver, label, f)
                    if count > 0:
                        print(f"  {label}: {count} nodes")
                        total += count
            if total == 0:
                raise ExportError(f"no {framework} nodes in the graph: was it ingested?")
            node_counts[framework] = total

        rel_paths = {b: os.path.join(args.output_dir, RELATIONSHIP_FILES[b]) for b in relationship_buckets}
        handles = {b: open(p, "w") for b, p in rel_paths.items()}
        try:
            print(f"Exporting relationships to {', '.join(rel_paths.values())}...")
            rel_counts = export_relationships(driver, handles)
        finally:
            for handle in handles.values():
                handle.close()

        print("\nExport complete!")
        for framework, total in node_counts.items():
            print(f"  {framework} nodes: {total}")
        for bucket, count in rel_counts.items():
            print(f"  {RELATIONSHIP_FILES[bucket]}: {count} relationships")

    finally:
        driver.close()


if __name__ == "__main__":
    try:
        main()
    except ExportError as err:
        print(f"Error: {err}", file=sys.stderr)
        sys.exit(1)
