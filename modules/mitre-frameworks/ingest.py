#!/usr/bin/env python3

import os
import json
import rdflib # type: ignore
import argparse
import requests # type: ignore

from rdflib import Namespace, RDF, RDFS, OWL # type: ignore
from neo4j import GraphDatabase # type: ignore
from dotenv import load_dotenv # type: ignore
from neontology import init_neontology, Neo4jConfig # type: ignore
from ontolocy.tools import MitreAttackParser # type: ignore

load_dotenv()

# ------------------------------------------------
# CONFIG
# ------------------------------------------------
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USERNAME", "neo4j")
NEO4J_PASS = os.getenv("NEO4J_PASSWORD")
if not NEO4J_PASS:
    raise SystemExit("Error: NEO4J_PASSWORD environment variable is required")

# PINNED, for the same reason the ATT&CK bundle is. The unversioned
# `ontologies/d3fend.owl` is a moving target: re-running the ingest months apart pulled a
# different D3FEND (6 URIs gone, 13 new) into what was meant to be an ATT&CK-only change,
# and made the ingest unreproducible. The OWL declares its own versionIRI, which resolves,
# so the version can be pinned and recorded in the module manifest instead of "unknown".
D3FEND_VERSION = "1.6.0"
D3FEND_OWL_FILE = f"https://d3fend.mitre.org/ontologies/d3fend/{D3FEND_VERSION}/d3fend.owl"
D3F = Namespace("http://d3fend.mitre.org/ontologies/d3fend.owl#")

# OBJ_PROPERTY_TO_REL_TYPE = {
#     D3F.runs: "RUNS",
#     D3F.terminates: "TERMINATES",
#     D3F.contains: "CONTAINS",
#     D3F.implements: "IMPLEMENTS",
#     D3F.instructs: "INSTRUCTS",
#     D3F.spoofs: "SPOOFS",
#     D3F.analyzes: "ANALYZES",
#     D3F.restores: "RESTORES",
#     # etc. Add more if desired
# }

MITRE_DEFEND_LABEL_MAPPING = {
    "DefensiveTactic": "MitreDefendTactic",
    "DefensiveTechnique": "MitreDefendTechnique",
    "Process": "MitreDefendProcessEntity",
    "Storage": "MitreDefendStorageEntity",
    "DigitalEvent": "MitreDefendDigitalEventEntity",
    "Sensor": "MitreDefendSensorEntity",
    "NetworkNode": "MitreDefendNetworkNodeEntity",
    "Link": "MitreDefendLinkEntity",
    "NetworkTraffic": "MitreDefendNetworkTrafficEntity",
    "SystemCall": "MitreDefendSystemCallEntity",
    "OSAPIFunction": "MitreDefendOSAPIFunctionEntity",
    "Subroutine": "MitreDefendSubroutineEntity",
    "Firmware": "MitreDefendFirmwareEntity",
    "UserAccount": "MitreDefendUserAccountEntity",
    "Credential": "MitreDefendCredentialEntity",
    "HardwareDevice": "MitreDefendHardwareDeviceEntity",
    "Software": "MitreDefendSoftwareEntity",
    "File": "MitreDefendFileEntity",
    "Resource": "MitreDefendResourceEntity",
    "DigitalInformationBearer": "MitreDefendDigitalInformationBearerEntity",
    "DigitalInformation": "MitreDefendDigitalInformationEntity",
    "DigitalArtifact": "MitreDefendDigitalArtifactEntity",
}

# Define mapping of old labels to new labels for optional MitreAttack re-labeling
MITRE_ATTACK_LABEL_MAPPING = {
    "MitreAttackGroup": "MitreAttackGroup",
    "MitreAttackCampaign": "MitreAttackCampaign",
    "MitreAttackSoftware": "MitreAttackSoftware",
    "MitreAttackTactic": "MitreAttackTactic",
    "MitreAttackTechnique": "MitreAttackTechnique",
    "MitreAttackDataSource": "MitreAttackDataSource",
    "MitreAttackDataComponent": "MitreAttackDataComponent",
    "MitreAttackMitigation": "MitreAttackMitigation",
}

# Define mapping of old relationships to new relationships for optional MitreAttack re-labeling
MITRE_ATTACK_REL_MAPPING = {
    "MITRE_TACTIC_INCLUDES_TECHNIQUE": "TACTIC_INCLUDES_TECHNIQUE",
    "MITRE_ATTACK_GROUP_USES_TECHNIQUE": "GROUP_USES_TECHNIQUE",
    "MITRE_ATTACK_GROUP_USES_SOFTWARE": "GROUP_USES_SOFTWARE",
    "MITRE_SUBTECHNIQUE_OF": "SUBTECHNIQUE_OF",
    "MITRE_CAMPAIGN_USES_SOFTWARE": "CAMPAIGN_USES_SOFTWARE",
    "MITRE_CAMPAIGN_ATTRIBUTED_TO_INTRUSION_SET": "CAMPAIGN_ATTRIBUTED_TO_INTRUSION_SET",
    "MITRE_CAMPAIGN_USES_TECHNIQUE": "CAMPAIGN_USES_TECHNIQUE",
    "MITRE_SOFTWARE_USES_TECHNIQUE": "SOFTWARE_USES_TECHNIQUE",
    "MITRE_ATTACK_MITIGATION_DEFENDS_AGAINST_TECHNIQUE": "MITIGATION_DEFENDS_AGAINST_TECHNIQUE",
    "MITRE_ATTACK_DATA_COMPONENT_DETECTS_TECHNIQUE": "DATA_COMPONENT_DETECTS_TECHNIQUE",
    "MITRE_ATTACK_DATA_SOURCE_HAS_COMPONENT": "DATA_SOURCE_HAS_COMPONENT",
}


# ------------------------------------------------
# NEO4J HELPER QUERIES
# ------------------------------------------------

def merge_taxonomy_node(tx, uri, name, definition, d3fend_id, label):
    query = f"""
    MERGE (n:{label} {{ uri: $uri }})
    ON CREATE SET n.id = randomUUID()
    SET n.name = $name,
        n.description = $definition,
        n.d3fendId = $d3fend_id
    """
    tx.run(query, uri=uri, name=name, definition=definition, d3fend_id=d3fend_id)

def merge_sub_entity_of(tx, child_uri, parent_uri ):
    query = """
    MATCH (child { uri: $childUri }), (parent { uri: $parentUri })
    MERGE (child)-[:SUB_ENTITY_OF]->(parent)
    """
    tx.run(query, childUri=child_uri, parentUri=parent_uri)

def merge_sub_technique_of(tx, child_uri, parent_uri):
    query = """
    MATCH (child { uri: $childUri }), (parent { uri: $parentUri })
    MERGE (child)-[:SUB_TECHNIQUE_OF]->(parent)
    """
    tx.run(query, childUri=child_uri, parentUri=parent_uri)

def merge_object_property_relationship(tx, subj_uri, rel_type, obj_uri):
    """
    Merges an arbitrary relationship type between two nodes that we already have in the graph.
    """
    query = f"""
    MATCH (s {{ uri: $suri }}), (o {{ uri: $ouri }})
    MERGE (s)-[r:{rel_type}]->(o)
    """
    tx.run(query, suri=subj_uri, ouri=obj_uri)

def get_attack_ids(tx):
    result = tx.run(f"MATCH (t:{MITRE_ATTACK_LABEL_MAPPING['MitreAttackTechnique']}) RETURN t.attack_id AS attack_id")
    return {record["attack_id"] for record in result}

def merge_attack_id(tx, label, name, rel_label, attack_id):
    query = f"""
    MATCH (n:{label} {{ name: $name }})
    MATCH (t:{MITRE_ATTACK_LABEL_MAPPING['MitreAttackTechnique']} {{ attack_id: $attack_id }})
    MERGE (n)<-[:{rel_label}]-(t)
    """
    tx.run(query, name=name, attack_id=attack_id)

# ------------------------------------------------
# ATT&CK SOURCE PIN + v19 PARSER COMPATIBILITY
# ------------------------------------------------
ATTACK_STIX_BUNDLE_URL = (
    "https://github.com/mitre-attack/attack-stix-data/raw/master/"
    "enterprise-attack/enterprise-attack-19.2.json"
)

# ontolocy 0.9.3 (the latest release) cannot parse a v19 bundle unaided.
#
# It builds each node DataFrame from the union of keys present, then drops
# `x_mitre_data_source_ref` from the data-component frame UNCONDITIONALLY
# (ontolocy/tools/mitre_attack.py, no errors="ignore"). ATT&CK finished removing that
# field in v19 — the 18.1 bundle still had it on 7 of 109 components, 19.2 has it on
# none, components now hanging off the detection-strategy/analytic objects — so the
# column does not exist and the parse dies with
#   KeyError: "['x_mitre_data_source_ref'] not found in axis".
#
# There is no upgrade to take. Materialise the absent optional field as null so the
# library's own drop is a no-op. This adds no data (the field genuinely has no value in
# v19) and is far narrower than forking the library's 150-line _parse.
_ontolocy_stix_objects_to_df = MitreAttackParser._stix_objects_to_df


def _stix_objects_to_df_v19_compatible(self, stix_data, stix_types):
    df = _ontolocy_stix_objects_to_df(self, stix_data, stix_types)
    if (
        "x-mitre-data-component" in stix_types
        and not df.empty
        and "x_mitre_data_source_ref" not in df.columns
    ):
        df["x_mitre_data_source_ref"] = None
    return df


MitreAttackParser._stix_objects_to_df = _stix_objects_to_df_v19_compatible


def _matrix_tactic_order(stix_json):
    """
    ATT&CK id -> 0-based position in the Enterprise matrix, read from the bundle's own
    `x-mitre-matrix.tactic_refs` (which is an ORDERED list).

    Every consumer that needs kill-chain order otherwise has to carry its own copy of
    the sequence, and the sequence changes: v19 inserted Defense Impairment (TA0112)
    between Stealth and Credential Access. ontolocy preserves no index on the tactic
    node or the matrix edge, so the order is present in the source and lost at ingest.
    Reading it here and storing it on the node keeps one definition, derived from MITRE
    rather than transcribed, and lets query code just ORDER BY it.
    """
    objects = stix_json["objects"]
    by_stix_id = {o["id"]: o for o in objects if o["type"] == "x-mitre-tactic"}
    matrices = [o for o in objects if o["type"] == "x-mitre-matrix"]
    if len(matrices) != 1:
        raise SystemExit(
            f"Error: expected exactly one x-mitre-matrix in the bundle, found {len(matrices)}"
        )
    order = {}
    for position, ref in enumerate(matrices[0]["tactic_refs"]):
        tactic = by_stix_id.get(ref)
        if tactic is None:
            raise SystemExit(f"Error: matrix references unknown tactic {ref}")
        attack_id = next(
            (
                r["external_id"]
                for r in tactic.get("external_references", [])
                if r.get("source_name") == "mitre-attack"
            ),
            None,
        )
        if attack_id is None:
            raise SystemExit(f"Error: tactic {ref} carries no mitre-attack external id")
        order[attack_id] = position
    return order


# ------------------------------------------------
# MAIN FUNCTIONS
# ------------------------------------------------

def ingest_attack():
    # 1. Initialize neontology 
    graph_config = Neo4jConfig(
        uri=NEO4J_URI,
        username=NEO4J_USER,
        password=NEO4J_PASS,
    )
    init_neontology(graph_config)

    # Fetched once and used twice: handed to the parser, and read for the matrix order
    # the parser discards. parse_data takes the raw text, exactly as parse_url would.
    bundle_text = requests.get(ATTACK_STIX_BUNDLE_URL, timeout=300).text
    tactic_order = _matrix_tactic_order(json.loads(bundle_text))

    parser = MitreAttackParser()
    parser.parse_data(bundle_text)

    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASS))
    # 2. Post-process in Neo4j to adjust labels, relationships, and add an id property
    with driver.session() as session:
        # A) Add 'id' property for all nodes 
        for label in MITRE_ATTACK_LABEL_MAPPING.keys():
            session.run(
                f"""
                MATCH (n:{label})
                SET n.id = randomUUID()
                """
            )

        # B) Rename Labels (remove "MitreAttack" prefix)
        for old_label, new_label in MITRE_ATTACK_LABEL_MAPPING.items():
            # Remove the old label and add the new label
            session.run(
                f"""
                MATCH (n:{old_label})
                REMOVE n:{old_label}
                SET n:{new_label}
                """
            )

        # C) Rename Relationships
        for old_rel, new_rel in MITRE_ATTACK_REL_MAPPING.items():
            # Create new relationships with the new type and copy properties
            session.run(
                f"""
                MATCH (start)-[r:{old_rel}]->(end)
                CREATE (start)-[r2:{new_rel}]->(end)
                SET r2 = properties(r)
                """
            )
            # Delete old relationships
            session.run(
                f"""
                MATCH ()-[r:{old_rel}]->()
                DELETE r
                """
            )

        # D) Stamp each tactic with its matrix position, so consumers can order by
        #    kill-chain stage without transcribing the sequence. Fails loudly on a
        #    tactic the matrix does not place: a silent null would sort it arbitrarily.
        for attack_id, position in tactic_order.items():
            session.run(
                """
                MATCH (t:MitreAttackTactic {attack_id: $attack_id})
                SET t.matrix_order = $position
                """,
                attack_id=attack_id,
                position=position,
            )
        unplaced = session.run(
            """
            MATCH (t:MitreAttackTactic) WHERE t.matrix_order IS NULL
            RETURN collect(t.attack_id) AS ids
            """
        ).single()["ids"]
        if unplaced:
            raise SystemExit(f"Error: tactics absent from the matrix ordering: {unplaced}")


def cleanup_attack():
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASS))
    with driver.session() as session:

        # delete all nodes
        for label in MITRE_ATTACK_LABEL_MAPPING.values():
            session.run(
                f"""
                MATCH (n:{label})
                DETACH DELETE n
                """
            )

    print("Done! Neo4j database has been updated with custom labels, relationships, and 'id' properties.")

def ingest_defend():
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASS))
    g = rdflib.Graph()
    g.parse(D3FEND_OWL_FILE)

    # HELPER: subClassOf check
    def is_subclass_of(child, parent):
        if child == parent:
            return True
        for sup in g.transitive_objects(child, RDFS.subClassOf):
            if sup == parent:
                return True
        return False

    class_parent_map = {}  # key=childClassUri, value=set of parentClassUris
    technique_uris = set()
    tactic_uris = set()
    taxonomy_uris = set()

    root_uris = [D3F[r] for r in MITRE_DEFEND_LABEL_MAPPING.keys()]

    # 1) Identify all OWL classes that eventually fall under one of these roots
    all_taxonomy_classes = set()
    for clazz in g.subjects(RDF.type, OWL.Class):
        # If clazz is subClassOf any root in root_uris, or equals a root, keep it
        for ru in root_uris:
            if is_subclass_of(clazz, ru):
                all_taxonomy_classes.add(clazz)
                break

    # 2) Build a child->parents map from subClassOf
    for child_clz in all_taxonomy_classes:
        for parent_clz in g.objects(child_clz, RDFS.subClassOf):
            if parent_clz in all_taxonomy_classes:
                child_uri_str = str(child_clz)
                parent_uri_str = str(parent_clz)
                class_parent_map.setdefault(child_uri_str, set()).add(parent_uri_str)

    # 3) We unify "class" and "named individual" for the same URI. 
    relevant_uris = {str(c) for c in all_taxonomy_classes}

    # 3b) Also gather NamedIndividuals that have exactly the same URI as one in all_taxonomy_classes
    for indiv in g.subjects(RDF.type, OWL.NamedIndividual):
        indiv_str = str(indiv)
        if indiv_str in relevant_uris:
            relevant_uris.add(indiv_str)

    # 3c) We'll store these URIs => we want to create a single node for each
    def get_nearest_root_label(clazz):
        """
        Finds which root (Software, Process, etc.) this class ultimately belongs to 
        and returns e.g. "SoftwareEntity". If not found, default to "MitreDefendTaxonomyEntity".
        """
        for root_name in MITRE_DEFEND_LABEL_MAPPING.keys():
            root_uri = D3F[root_name]
            if is_subclass_of(clazz, root_uri):
                # If we have a custom label in MITRE_DEFEND_LABEL_MAPPING, return that
                return MITRE_DEFEND_LABEL_MAPPING.get(root_name, "MitreDefendTaxonomyEntity")
        return "TMitreDefendaxonomyEntity"

    # We'll need to store some info for each URI: name, definition, etc.
    node_data = {}

    # 3d) Fill in data from the classes
    for clz in all_taxonomy_classes:
        clz_uri_str = str(clz)
        name_lit = g.value(clz, RDFS.label)
        name_str = str(name_lit) if name_lit else clz_uri_str.split('#')[-1]
        definition_lit = g.value(clz, D3F.definition)
        definition_str = str(definition_lit) if definition_lit else None
        d3id_lit = g.value(clz, D3F["d3fend-id"])
        d3id_str = str(d3id_lit) if d3id_lit else None

        # figure out label
        label = get_nearest_root_label(clz)
        node_data[clz_uri_str] = {
            "name": name_str,
            "definition": definition_str,
            "d3fend_id": d3id_str,
            "label": label
        }
        if label == "MitreDefendTechnique":
            technique_uris.add(clz_uri_str)
        elif label == "MitreDefendTactic":
            tactic_uris.add(clz_uri_str)
        else:
            taxonomy_uris.add(clz_uri_str)

    # 3e) Fill in data from any NamedIndividual that shares the same URI
    for indiv in g.subjects(RDF.type, OWL.NamedIndividual):
        indiv_uri_str = str(indiv)
        if indiv_uri_str in node_data:
            # we unify
            # if there's object properties that define "name" etc., we might set them here. 
            # Typically "name" is from rdfs:label or so.
            name_lit = g.value(indiv, RDFS.label)
            if name_lit:
                node_data[indiv_uri_str]["name"] = str(name_lit)
            definition_lit = g.value(indiv, D3F.definition)
            if definition_lit:
                node_data[indiv_uri_str]["definition"] = str(definition_lit)
            d3id_lit = g.value(indiv, D3F["d3fend-id"])
            if d3id_lit:
                node_data[indiv_uri_str]["d3fend_id"] = str(d3id_lit)
            # So we keep the same label from the class side. 
        else:
            # This named individual might not appear in the class set. Possibly it's not subClassOf or is a partial name match. 
            pass

    # 4) Insert these taxonomy nodes into Neo4j, build SUB_ENTITY_OF edges
    with driver.session() as session:

        # Insert each taxonomy node
        for uri_str, data in node_data.items():
            session.execute_write(
                merge_taxonomy_node,
                uri_str,
                data["name"],
                data["definition"],
                data["d3fend_id"],
                data["label"]
            )

        # Build hierarchy edges 
        for child_uri_str, parents in class_parent_map.items():
            # if child is recognized
            if child_uri_str in node_data:
                for p_uri_str in parents:
                    if p_uri_str in node_data:
                        child_label = node_data[child_uri_str]["label"]
                        parent_label = node_data[p_uri_str]["label"]
                        if child_label == "MitreDefendTechnique" and parent_label == "MitreDefendTechnique":
                            session.execute_write(
                                merge_sub_technique_of,
                                child_uri_str,
                                p_uri_str
                            )
                        else:
                            session.execute_write(
                                merge_sub_entity_of,
                                child_uri_str,
                                p_uri_str
                            )

        attack_ids = session.read_transaction(get_attack_ids)

        # 5) Now add the object property relationships from NamedIndividuals 
        for (s, p, o) in g.triples((None, None, None)):
            rel_type = p.split('#')[-1].upper().replace("-", "_")
            if str(s) in technique_uris and str(o) in tactic_uris | taxonomy_uris:
                session.execute_write(
                    merge_object_property_relationship,
                    str(s),
                    rel_type,
                    str(o)
                )
            attack_id = str(s).split('#')[-1]
            if str(o) in taxonomy_uris and attack_id in attack_ids:
                session.execute_write(
                    merge_attack_id,
                    node_data[str(o)]["label"],
                    node_data[str(o)]["name"],
                    rel_type,
                    attack_id
                )
            if str(o) in taxonomy_uris and str(s) in taxonomy_uris and str(o) != str(s) and rel_type != "SUBCLASSOF" and rel_type != "TYPE":
                session.execute_write(
                    merge_object_property_relationship,
                    str(s),
                    rel_type,
                    str(o)
                )

    print("Done! Merged classes + named individuals for the taxonomy, built subClassOf-based hierarchy, and object-property edges.")

def cleanup_defend():
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASS))
    with driver.session() as session:
        for label in MITRE_DEFEND_LABEL_MAPPING.values():
            session.run(
                f"""
                MATCH (n:{label})
                DETACH DELETE n
                """
            )

    print("Done! Deleted all nodes in the graph.")

def main():
    parser = argparse.ArgumentParser(description="Ingest D3FEND OWL file into Neo4j")
    parser.add_argument("--cleanup", action="store_true", help="Cleanup Neo4j database")
    args = parser.parse_args()
    if args.cleanup:
        cleanup_defend()
        cleanup_attack()
    else:
        ingest_attack()
        ingest_defend()

if __name__ == "__main__":
    main()