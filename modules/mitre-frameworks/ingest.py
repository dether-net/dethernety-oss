#!/usr/bin/env python3

import os
import rdflib # type: ignore
import argparse

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
NEO4J_PASS = os.getenv("NEO4J_PASSWORD", "password")

D3FEND_OWL_FILE = "https://d3fend.mitre.org/ontologies/d3fend.owl"
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
    result = tx.run(f"MATCH (t:{MITRE_ATTACK_LABEL_MAPPING["MitreAttackTechnique"]}) RETURN t.attack_id AS attack_id")
    return {record["attack_id"] for record in result}

def merge_attack_id(tx, label, name, rel_label, attack_id):
    query = f"""
    MATCH (n:{label} {{ name: $name }})
    MATCH (t:{MITRE_ATTACK_LABEL_MAPPING["MitreAttackTechnique"]} {{ attack_id: $attack_id }})
    MERGE (n)<-[:{rel_label}]-(t)
    """
    tx.run(query, name=name, attack_id=attack_id)

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

    parser = MitreAttackParser()
    parser.parse_url(
        "https://github.com/mitre-attack/attack-stix-data/raw/master/enterprise-attack/enterprise-attack.json"
    )

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