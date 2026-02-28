#!/usr/bin/env python3

import os
import rdflib # type: ignore
from rdflib import Namespace, RDF, RDFS, OWL # type: ignore
# The main D3FEND OWL source
D3FEND_OWL_FILE = "https://d3fend.mitre.org/ontologies/d3fend.owl"
D3F = Namespace("http://d3fend.mitre.org/ontologies/d3fend.owl#")

# We'll keep your existing approach for Tactics & Techniques:
ENABLED_PROP = D3F.enables

# Additional taxonomy root classes (we only ingest punned NamedIndividuals under these)
TAXONOMY_ROOTS = [
    "DigitalEvent",
    "Sensor",
    "Process",
    "NetworkNode",
    "Link",
    "Software",
    "NetworkTraffic",
    "SystemCall",
    "OSAPIFunction",
    "Subroutine",
    "Firmware",
    "Storage",
    "UserAccount",
    "Credential",
    "Resource",
    "HardwareDevice",
]

# ------------------------------------------------
# MAIN
# ------------------------------------------------

def main():
    g = rdflib.Graph()
    g.parse(D3FEND_OWL_FILE)

    # Helper function for rdfs:subClassOf checks
    def is_subclass_of(child, parent):
        if child == parent:
            return True
        for sup in g.transitive_objects(child, RDFS.subClassOf):
            if sup == parent:
                return True
        return False

    ################################
    # 1) TACTICS
    ################################
    tactic_uris = set()
    for indiv in g.subjects(RDF.type, OWL.NamedIndividual):
        typed_classes = [c for c in g.objects(indiv, RDF.type) if c != OWL.NamedIndividual]
        for tc in typed_classes:
            if is_subclass_of(tc, D3F.DefensiveTactic):
                tactic_uris.add(indiv)

    ################################
    # 2) TECHNIQUES
    ################################
    technique_uris = set()
    for indiv in g.subjects(RDF.type, OWL.NamedIndividual):
        typed_classes = [c for c in g.objects(indiv, RDF.type) if c != OWL.NamedIndividual]
        for tc in typed_classes:
            if is_subclass_of(tc, D3F.DefensiveTechnique):
                technique_uris.add(indiv)

    # Build sub-technique chain from class punning
    technique_class_parent_map = {}
    all_technique_classes = [
        c for c in g.subjects(RDF.type, OWL.Class)
        if is_subclass_of(c, D3F.DefensiveTechnique)
    ]
    for child_clz in all_technique_classes:
        child_uri_str = str(child_clz)
        for parent_clz in g.objects(child_clz, RDFS.subClassOf):
            if parent_clz in all_technique_classes:
                parent_uri_str = str(parent_clz)
                technique_class_parent_map.setdefault(child_uri_str, set()).add(parent_uri_str)

    ################################
    # 3) TAXONOMY ENTITIES
    ################################
    # We'll ingest only NamedIndividuals typed as or subClassOf these roots:
    taxonomy_root_uris = [D3F[root] for root in TAXONOMY_ROOTS]
    all_taxonomy_classes = set()

    # Gather all classes subClassOf these roots (plus the roots themselves).
    for root in taxonomy_root_uris:
        all_taxonomy_classes.add(root)
        for clazz in g.subjects(RDF.type, OWL.Class):
            if is_subclass_of(clazz, root):
                all_taxonomy_classes.add(clazz)

    # parent_map for child->parents
    taxonomy_class_parent_map = {}
    for child_clz in all_taxonomy_classes:
        child_uri_str = str(child_clz)
        # gather direct parents
        for parent_clz in g.objects(child_clz, RDFS.subClassOf):
            if parent_clz in all_taxonomy_classes:
                parent_uri_str = str(parent_clz)
                taxonomy_class_parent_map.setdefault(child_uri_str, set()).add(parent_uri_str)

    # Gather all NamedIndividuals that are typed as or subClassOf one of those classes
    taxonomy_uris = set()
    for indiv in g.subjects(RDF.type, OWL.NamedIndividual):
        typed_classes = [c for c in g.objects(indiv, RDF.type) if c != OWL.NamedIndividual]
        for tc in typed_classes:
            if tc in all_taxonomy_classes or any(is_subclass_of(tc, root) for root in all_taxonomy_classes):
                taxonomy_uris.add(indiv)
                break

    ################################
    # 4) Insert into Neo4j
    ################################
    # session.run("MATCH (n) DETACH DELETE n")  # optional: clear everything

    # 4a) Tactics
    # for t_uri in tactic_uris:
    #     t_str = str(t_uri)
    #     name_lit = g.value(t_uri, RDFS.label)
    #     name_str = str(name_lit) if name_lit else t_str.split('#')[-1]
    #     def_lit = g.value(t_uri, D3F.definition)
    #     definition_str = str(def_lit) if def_lit else None
    #     did_lit = g.value(t_uri, D3F["d3fend-id"])
    #     did_str = str(did_lit) if did_lit else None

    #     print (t_str, name_str, definition_str, did_str)

    # # 4b) Techniques
    # for tec_uri in technique_uris:
    #     tec_str = str(tec_uri)
    #     name_lit = g.value(tec_uri, RDFS.label)
    #     name_str = str(name_lit) if name_lit else tec_str.split('#')[-1]
    #     def_lit = g.value(tec_uri, D3F.definition)
    #     definition_str = str(def_lit) if def_lit else None
    #     did_lit = g.value(tec_uri, D3F["d3fend-id"])
    #     did_str = str(did_lit) if did_lit else None

    #     print(tec_str, name_str, definition_str, did_str)

    # # Build SUB_TECHNIQUE_OF edges among NamedIndividuals
    # for child_uri_str, parent_set in technique_class_parent_map.items():
    #     child_ref = rdflib.URIRef(child_uri_str)
    #     if child_ref in technique_uris:
    #         for par_uri_str in parent_set:
    #             parent_ref = rdflib.URIRef(par_uri_str)
    #             if parent_ref in technique_uris:
    #                 print(child_uri_str, par_uri_str)

    # 4c) Taxonomy Entities
    # for tax_uri in taxonomy_uris:
    #     tax_str = str(tax_uri)
    #     name_lit = g.value(tax_uri, RDFS.label)
    #     name_str = str(name_lit) if name_lit else tax_str.split('#')[-1]
    #     def_lit = g.value(tax_uri, D3F.definition)
    #     definition_str = str(def_lit) if def_lit else None
    #     did_lit = g.value(tax_uri, D3F["d3fend-id"])
    #     did_str = str(did_lit) if did_lit else None

    #     print(tax_str,name_str,definition_str,did_str)

    # # Now build SUB_ENTITY_OF edges from the class pun
    # for child_uri_str, parent_set in taxonomy_class_parent_map.items():
    #     child_ref = rdflib.URIRef(child_uri_str)
    #     if child_ref in taxonomy_uris:
    #         for par_uri_str in parent_set:
    #             parent_ref = rdflib.URIRef(par_uri_str)
    #             if parent_ref in taxonomy_uris:
    #                 print(child_uri_str, par_uri_str)

    # # 4d) Create :ENABLES edges from technique to tactic if declared at the individual level
    # for tec_uri in technique_uris:
    #     for tac_obj in g.objects(tec_uri, ENABLED_PROP):
    #         if tac_obj in tactic_uris:
    #             print(str(tec_uri),str(tac_obj))

    # print("Done! Ingested Tactics, Techniques, plus your specified Taxonomy Entities. Sub-hierarchies created for each via class punning.")

if __name__ == "__main__":
    main()