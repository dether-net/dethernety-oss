#!/usr/bin/env python3
"""
Export MITRE ATT&CK and D3FEND data from Memgraph to Cypher files.

Generates MERGE statements with appropriate unique identifiers for upsert behavior:
- ATT&CK nodes: MERGE on attack_id
- D3FEND techniques/tactics: MERGE on d3fendId
- D3FEND entities: MERGE on uri
"""

import os
import argparse
import json
from typing import Dict, List, Any, Optional
from neo4j import GraphDatabase

# Environment variables
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USERNAME", "neo4j")
NEO4J_PASS = os.getenv("NEO4J_PASSWORD", "password")

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


def export_nodes(
    driver,
    label: str,
    unique_key: str,
    output_file,
    fallback_key: Optional[str] = None
) -> int:
    """Export nodes for a label with MERGE statements."""
    count = 0
    with driver.session() as session:
        result = session.run(f"MATCH (n:{label}) RETURN n")
        for record in result:
            node = record["n"]
            props = dict(node)

            # Get the unique key value
            key_value = props.get(unique_key)

            # Handle fallback for nodes without primary key (e.g., d3fendId)
            if key_value is None and fallback_key:
                key_value = props.get(fallback_key)
                if key_value:
                    unique_key_used = fallback_key
                else:
                    # Skip nodes without any unique identifier
                    print(f"  Warning: Skipping {label} node without {unique_key} or {fallback_key}")
                    continue
            elif key_value is None:
                # Try to use 'name' as a fallback for some edge cases
                if 'name' in props:
                    unique_key_used = 'name'
                    key_value = props['name']
                else:
                    print(f"  Warning: Skipping {label} node without {unique_key}")
                    continue
            else:
                unique_key_used = unique_key

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

            count += 1

    return count


def export_relationships(driver, output_file) -> int:
    """Export relationships between MITRE nodes."""
    count = 0

    # Build a map of label -> unique key for source/target matching
    all_labels = {**ATTACK_LABELS, **DEFEND_LABELS}

    with driver.session() as session:
        # Get all relationships involving MITRE nodes
        query = """
        MATCH (s)-[r]->(t)
        WHERE any(label IN labels(s) WHERE label STARTS WITH 'Mitre')
          AND any(label IN labels(t) WHERE label STARTS WITH 'Mitre')
        RETURN s, type(r) AS rel_type, properties(r) AS rel_props, t
        """
        result = session.run(query)

        for record in result:
            source = record["s"]
            target = record["t"]
            rel_type = record["rel_type"]
            rel_props = record["rel_props"] or {}

            # Get source label and unique key
            source_labels = [l for l in source.labels if l.startswith("Mitre")]
            target_labels = [l for l in target.labels if l.startswith("Mitre")]

            if not source_labels or not target_labels:
                continue

            source_label = source_labels[0]
            target_label = target_labels[0]

            # Get unique keys
            source_key = all_labels.get(source_label, "attack_id")
            target_key = all_labels.get(target_label, "attack_id")

            # Get key values
            source_props = dict(source)
            target_props = dict(target)

            source_key_value = source_props.get(source_key)
            target_key_value = target_props.get(target_key)

            # Handle fallback to uri for D3FEND
            if source_key_value is None and source_label.startswith("MitreDefend"):
                source_key = "uri"
                source_key_value = source_props.get("uri")
            if target_key_value is None and target_label.startswith("MitreDefend"):
                target_key = "uri"
                target_key_value = target_props.get("uri")

            # Skip if we can't identify nodes
            if source_key_value is None or target_key_value is None:
                continue

            # Build relationship Cypher
            source_match = escape_cypher_string(source_key_value)
            target_match = escape_cypher_string(target_key_value)

            output_file.write(f"MATCH (s:{source_label} {{{source_key}: {source_match}}})\n")
            output_file.write(f"MATCH (t:{target_label} {{{target_key}: {target_match}}})\n")

            if rel_props:
                props_str = ", ".join(
                    f"{k}: {escape_cypher_string(v)}"
                    for k, v in rel_props.items()
                    if v is not None
                )
                output_file.write(f"MERGE (s)-[:{rel_type} {{{props_str}}}]->(t);\n")
            else:
                output_file.write(f"MERGE (s)-[:{rel_type}]->(t);\n")

            output_file.write("\n")
            count += 1

    return count


def main():
    parser = argparse.ArgumentParser(
        description="Export MITRE ATT&CK and D3FEND data to Cypher files"
    )
    parser.add_argument(
        "--output-dir",
        default="./data",
        help="Output directory for Cypher files"
    )
    args = parser.parse_args()

    # Create output directory
    os.makedirs(args.output_dir, exist_ok=True)

    # Connect to database
    print(f"Connecting to {NEO4J_URI}...")
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASS))

    try:
        # Export ATT&CK nodes
        attack_file_path = os.path.join(args.output_dir, "01-attack-nodes.cypher")
        print(f"Exporting ATT&CK nodes to {attack_file_path}...")
        attack_count = 0
        with open(attack_file_path, "w") as f:
            # Note: No comments - Memgraph mgconsole doesn't handle // comments when piped via stdin

            for label, unique_key in ATTACK_LABELS.items():
                count = export_nodes(driver, label, unique_key, f)
                if count > 0:
                    print(f"  {label}: {count} nodes")
                    attack_count += count

        print(f"Total ATT&CK nodes: {attack_count}")

        # Export D3FEND nodes
        defend_file_path = os.path.join(args.output_dir, "02-defend-nodes.cypher")
        print(f"Exporting D3FEND nodes to {defend_file_path}...")
        defend_count = 0
        with open(defend_file_path, "w") as f:
            # Note: No comments - Memgraph mgconsole doesn't handle // comments when piped via stdin

            for label, unique_key in DEFEND_LABELS.items():
                # D3FEND entities may use uri as fallback
                fallback = "uri" if unique_key == "d3fendId" else None
                count = export_nodes(driver, label, unique_key, f, fallback_key=fallback)
                if count > 0:
                    print(f"  {label}: {count} nodes")
                    defend_count += count

        print(f"Total D3FEND nodes: {defend_count}")

        # Export relationships
        rel_file_path = os.path.join(args.output_dir, "03-relationships.cypher")
        print(f"Exporting relationships to {rel_file_path}...")
        with open(rel_file_path, "w") as f:
            # Note: No comments - Memgraph mgconsole doesn't handle // comments when piped via stdin

            rel_count = export_relationships(driver, f)

        print(f"Total relationships: {rel_count}")

        print("\nExport complete!")
        print(f"  ATT&CK nodes: {attack_count}")
        print(f"  D3FEND nodes: {defend_count}")
        print(f"  Relationships: {rel_count}")

    finally:
        driver.close()


if __name__ == "__main__":
    main()
