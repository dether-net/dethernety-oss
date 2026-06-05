import { Logger } from '@nestjs/common';
import {
  DTModule,
  DTMetadata,
  ModuleResolverContext,
  ResolverMap,
} from '@dethernety/dt-module';
import {
  aggregateCoverage,
  BaseRow,
  DirectRow,
  MitigationRow,
  D3fendRow,
} from './aggregateCoverage';

/**
 * Dethernety Coverage Tools — a shared, backend-only DTModule that provides
 * graded, element-scoped, DISPOSITION-AGNOSTIC MITRE coverage facts as a single
 * GraphQL query field. No frontend, no classes, no analysis, no presentation.
 *
 * It exists as its own module (rather than inlined in any one consumer) because
 * coverage is genuinely multi-consumer (the platform's control-gaps-resolver is
 * already consumed by more than one tool). The consuming surface layers its own
 * disposition filter, tier-segregated bucketing, and no-% honest presentation on
 * top of these raw facts.
 *
 * The graded bridge has three tiers (each verified against a live graph):
 *   - DIRECT             — Countermeasure -[:COUNTERMEASURE_MITIGATES
 *                          |_PROTECTS_AGAINST|_DETECTS|_ISOLATES]-> Technique
 *                          (author-asserted; the optional enrichment most real
 *                          controls lack, so this tier is often empty).
 *   - INDIRECT-Mitigation — Countermeasure -[:RESPONDS_WITH]-> MitreAttackMitigation
 *                          -[:MITIGATION_DEFENDS_AGAINST_TECHNIQUE]-> Technique.
 *   - INDIRECT-D3FEND    — Countermeasure -[:RESPONDS_WITH]-> MitreDefendTechnique
 *                          → (shared MitreDefend*Entity artifact) ← Technique.
 *                          The artifact bridge is OWL-derived + UNTYPED in the
 *                          GraphQL schema (offensive verbs PRODUCES/MODIFIES/…
 *                          on the ATT&CK side, defensive ANALYZES/MONITORS/… on
 *                          the D3FEND side), so it is matched by raw Cypher,
 *                          verb-agnostic, bounded to the MitreDefend*Entity node
 *                          label family.
 *
 * Every tier is ELEMENT-SCOPED: a technique counts as covered for an exposure
 * only when the covering countermeasure's parent Control SUPPORTS the exposed
 * element (or its boundary) — mirroring the platform's control-gaps-resolver. A
 * countermeasure that counters a technique on some OTHER element does not cover
 * this element's exposure. detect/prevent is classified per covering edge; the
 * detect-only REDUCTION ("detective-only iff no preventive edge survives at any
 * tier") is left to the consuming surface, preserving the raw-facts contract.
 *
 * ANCHOR-FIRST (precision and bound): each tier query evaluates the
 * element-support join + the exposure's EXPLOITED_BY technique set FIRST, then
 * tests the tier hop against that already-pinned (countermeasure, technique)
 * pair. The broad D3FEND fan-out (a defend-technique can bridge to dozens of
 * attack techniques through shared artifacts) is therefore eliminated by
 * construction — we test "does this defend-technique bridge to THIS exposure's
 * technique", never enumerate the defend-technique's whole bridge set — so no
 * explicit cap is needed.
 *
 * The driver handed to the constructor is the secure, session-scoping driver;
 * this module adds NO authz and broadens NO scope — the JWT guard + session
 * scoping own that. All queries are read-only and carry a defensive transaction
 * timeout (well under the platform's module-load budget).
 */
class DethernetyCoverageToolsModule implements DTModule {
  private readonly logger: Logger;
  private readonly driver: any;
  /** Captured from the resolver context at startup; scopes every session. */
  private databaseName: string | undefined;

  constructor(driver: any, logger: Logger) {
    this.driver = driver;
    this.logger = logger;
  }

  getMetadata(): DTMetadata {
    return {
      name: 'dethernety-coverage-tools',
      description:
        'Graded, element-scoped, disposition-agnostic MITRE coverage facts (a reusable query primitive).',
      version: '1.0.0',
      author: 'Dethernety',
    };
  }

  /**
   * One uniquely-named query (schema-merge drops a colliding resolver silently,
   * so the name must not collide with the platform's `controlGaps` or any other
   * module). Returns the coverage facts as a JSON-encoded String — the same
   * shape the sibling threat-report module uses for its custom field, which
   * avoids @neo4j/graphql treating a newly-declared object type as a node.
   */
  getSchemaExtension(): string {
    return /* GraphQL */ `
      extend type Query {
        """Graded, element-scoped, disposition-agnostic MITRE coverage facts for a model, as a JSON-encoded string. Raw primitive — no disposition filter, no bucketing, no percentage. See dethernety-coverage-tools."""
        gradedCoverage(modelId: ID!): String
      }
    `;
  }

  getResolvers(context: ModuleResolverContext): ResolverMap {
    // Called once at startup — capture the scoped database name.
    this.databaseName = context.databaseName;

    return {
      Query: {
        gradedCoverage: async (_parent: any, args: any) => {
          const modelId = String(args?.modelId ?? '');
          if (!modelId) return null;
          const result = await this.computeGradedCoverage(modelId);
          return JSON.stringify(result);
        },
      },
    };
  }

  private session() {
    return this.driver.session(
      this.databaseName ? { database: this.databaseName } : {},
    );
  }

  /** Run one read-only query. The primary bound is the query itself: anchor-first
   *  evaluation keeps every tier hop pinned to an (element-supported countermeasure,
   *  exposed technique) pair, so there is no unbounded fan-out to begin with. The
   *  transaction-config `timeout` is a defensive ceiling — honored by the Neo4j
   *  driver; on Memgraph per-query bounding is governed server-side
   *  (query-execution-timeout), so this is belt-and-suspenders, not the load-bearing
   *  bound. (A raw-Cypher resolver is not covered by the GraphQL complexity limits,
   *  which is why the resolver owns its own bound at all.) */
  private async runRead(cypher: string, params: Record<string, any>): Promise<any[]> {
    const session = this.session();
    try {
      const result = await session.executeRead(
        async (tx: any) => tx.run(cypher, params),
        { timeout: 25000 },
      );
      return result.records;
    } finally {
      await session.close();
    }
  }

  /**
   * Element discovery shared by every query: the model's Component / DataFlow /
   * SecurityBoundary / Data elements. Every kind is gathered with its OWN
   * OPTIONAL MATCH rooted at `model` (boundary forest via `BELONGS_TO*0..` →
   * contained components → their flows; Data via model CONTAINS) and only the
   * FINAL combined list is UNWOUND — so a model with no boundaries but with Data
   * still yields its Data elements (a leading required boundary MATCH, or an
   * UNWIND of an intermediate boundary list, would collapse such a model to zero
   * rows). Ends `WITH DISTINCT element` so each query appends its own anchor +
   * tier hop. Mirrors the proven element-discovery in the sibling report module;
   * engine-portable (no nested EXISTS, scalar collects, bounded BELONGS_TO walk).
   */
  private static readonly ELEMENT_DISCOVERY = `
    MATCH (model:Model {id: $modelId})
    OPTIONAL MATCH (model)-[:CONTAINS]->(:SecurityBoundary)<-[:BELONGS_TO*0..50]-(b:SecurityBoundary)
    WITH model, collect(DISTINCT b) AS boundaries
    OPTIONAL MATCH (model)-[:CONTAINS]->(:SecurityBoundary)<-[:BELONGS_TO*0..50]-(:SecurityBoundary)<-[:BELONGS_TO]-(c:Component)
    WITH model, boundaries, collect(DISTINCT c) AS components
    OPTIONAL MATCH (model)-[:CONTAINS]->(:SecurityBoundary)<-[:BELONGS_TO*0..50]-(:SecurityBoundary)<-[:BELONGS_TO]-(:Component)-[:FLOWS]-(df:DataFlow)
    WITH model, boundaries, components, collect(DISTINCT df) AS flows
    OPTIONAL MATCH (model)-[:CONTAINS]->(d:Data)
    WITH boundaries, components, flows, collect(DISTINCT d) AS dataItems
    WITH [el IN boundaries + components + flows + dataItems WHERE el IS NOT NULL] AS allElements
    UNWIND allElements AS element
    WITH DISTINCT element
  `;

  /**
   * The element-support anchor shared by the three tier queries: pin the
   * exposure's exploited technique AND the element-supporting countermeasures
   * (direct `SUPPORTS` OR one-level boundary-inherited, mirroring
   * control-gaps-resolver), then UNWIND the surviving countermeasures so the
   * tier hop only ever expands from an already-pinned (cm, technique) pair.
   */
  // Boundary inheritance is exactly ONE `BELONGS_TO` level (cmBnd), faithfully
  // mirroring the platform's control-gaps-resolver — a control on a grandparent
  // boundary is not credited (a known, platform-consistent under-count, not a
  // bug). Only Component and SecurityBoundary declare `BELONGS_TO`, so the
  // boundary-inherited hop is a structural no-op for DataFlow and Data elements
  // (they are credited DIRECT `SUPPORTS` only) — also matching the reference
  // resolver and the no-`supportedData` reality.
  private static readonly SUPPORT_ANCHOR = `
    MATCH (element)-[:HAS_EXPOSURE]->(exp:Exposure)-[:EXPLOITED_BY]->(t:MitreAttackTechnique)
    OPTIONAL MATCH (element)<-[:SUPPORTS]-(:Control)-[:HAS_COUNTERMEASURE]->(cmDirect:Countermeasure)
    OPTIONAL MATCH (element)-[:BELONGS_TO]->(:SecurityBoundary)<-[:SUPPORTS]-(:Control)-[:HAS_COUNTERMEASURE]->(cmBnd:Countermeasure)
    WITH exp, t, [x IN collect(DISTINCT cmDirect) + collect(DISTINCT cmBnd) WHERE x IS NOT NULL] AS cms
    UNWIND cms AS cm
  `;

  private async computeGradedCoverage(modelId: string) {
    const D = DethernetyCoverageToolsModule.ELEMENT_DISCOVERY;
    const A = DethernetyCoverageToolsModule.SUPPORT_ANCHOR;

    // 1) Base anchor: one row per (element, exposure, exploited technique) carrying
    //    the technique's ATT&CK tactic(s) — the matrix COLUMNS. An exposure with no
    //    EXPLOITED_BY technique yields a single row with techniqueId = null (the
    //    soft/unmapped marker). Tactic is resolved through SUBTECHNIQUE_OF*0..1: an
    //    ATT&CK sub-technique (single-level, e.g. T1078.004 → T1078) belongs to its
    //    parent's tactic(s), so a single TACTIC_INCLUDES_TECHNIQUE hop could drop a
    //    sub-technique's column. `*0..1` unions the technique's own tactic edges with
    //    its parent's — correct-by-derivation (here every sub-technique also carries
    //    direct tactic edges, so it is robustness, not a live fix). NOTE: ATT&CK's
    //    `SUBTECHNIQUE_OF` (no underscore between SUB and TECHNIQUE) is a DIFFERENT
    //    relationship from D3FEND's `SUB_TECHNIQUE_OF` used in the d3fend tier below.
    const baseCypher = `${D}
      MATCH (element)-[:HAS_EXPOSURE]->(exp:Exposure)
      OPTIONAL MATCH (exp)-[:EXPLOITED_BY]->(t:MitreAttackTechnique)
      OPTIONAL MATCH (t)-[:SUBTECHNIQUE_OF*0..1]->(tp:MitreAttackTechnique)<-[:TACTIC_INCLUDES_TECHNIQUE]-(tac:MitreAttackTactic)
      WITH element, exp, t, [x IN collect(DISTINCT tac.name) WHERE x IS NOT NULL] AS tactics
      RETURN element.id AS elementId,
             [l IN labels(element) WHERE l IN ['Component','DataFlow','SecurityBoundary','Data']][0] AS elementKind,
             exp.id AS exposureId,
             t.attack_id AS techniqueId,
             t.name AS techniqueName,
             t.description AS techniqueDescription,
             tactics`;

    // Two refinements shared by all three tier hops:
    //  - SUB-TECHNIQUE COVERAGE INHERITANCE: a covering edge lands on `ct`, the
    //    exposed technique `t` OR its single parent, via `(t)-[:SUBTECHNIQUE_OF*0..1]->(ct)`.
    //    Coverage flows DOWN the hierarchy — a mitigation on a parent technique
    //    covers its sub-techniques — never UP (a single sub-technique's mitigation
    //    does not cover the parent/siblings), so the walk is rooted at `t` and
    //    directed at its ancestors only. The covering fact is attributed to `t`
    //    (the exposure's own technique = the matrix row), not `ct`. Bounded
    //    single-level (ATT&CK sub-techniques are one level), so anchor-first holds.
    //  - controlId: the covering countermeasure's parent Control. HAS_COUNTERMEASURE
    //    is 1 control per countermeasure (verified), so this is a single hop with no
    //    fan-out; the report uses it for the Residual Risk configured-mismatch signal + L3 provenance.

    // 2) DIRECT tier: a supporting countermeasure with an author-asserted edge to
    //    the exposed technique (or its parent). type(r) IN [...] is the most
    //    engine-portable form.
    const directCypher = `${D}${A}
      MATCH (cm)-[r]->(ct:MitreAttackTechnique)
      WHERE type(r) IN ['COUNTERMEASURE_MITIGATES','COUNTERMEASURE_PROTECTS_AGAINST','COUNTERMEASURE_DETECTS','COUNTERMEASURE_ISOLATES']
      MATCH (t)-[:SUBTECHNIQUE_OF*0..1]->(ct)
      MATCH (ctrl:Control)-[:HAS_COUNTERMEASURE]->(cm)
      RETURN DISTINCT exp.id AS exposureId, t.attack_id AS techniqueId, cm.id AS cmId, ctrl.id AS controlId, type(r) AS relType`;

    // 3) INDIRECT-Mitigation tier (catalogue mitigation ⇒ preventive).
    const mitigationCypher = `${D}${A}
      MATCH (cm)-[:RESPONDS_WITH]->(:MitreAttackMitigation)-[:MITIGATION_DEFENDS_AGAINST_TECHNIQUE]->(ct:MitreAttackTechnique)
      MATCH (t)-[:SUBTECHNIQUE_OF*0..1]->(ct)
      MATCH (ctrl:Control)-[:HAS_COUNTERMEASURE]->(cm)
      RETURN DISTINCT exp.id AS exposureId, t.attack_id AS techniqueId, cm.id AS cmId, ctrl.id AS controlId`;

    // 4) INDIRECT-D3FEND tier: the defend-technique reaches the exposed technique
    //    ONLY through a shared D3FEND artifact. The two artifact hops MUST stay in
    //    a single `MATCH (dt)--(art)--(t)` — relationship-isomorphism (both
    //    engines) then guarantees the two anonymous edges are distinct; splitting
    //    them into separate MATCH clauses would let one edge bind both and fake a
    //    self-bridge. `art` is bound to the MitreDefend*Entity label family
    //    (verb-agnostic, directionless — the edges are OWL-derived + untyped); the
    //    label filter also guarantees art != dt and art != t. Anchored to t, so
    //    this is a bounded existence test, never the broad artifact fan-out.
    //    Tactic (detect/prevent) is read via SUB_TECHNIQUE_OF|ENABLES*0..: in the
    //    D3FEND ontology a sub-technique inherits its tactic from its parent, so a
    //    single-hop ENABLES would miss it and mislabel detective coverage as
    //    preventive — this mirrors the platform's own D3FEND→tactic traversal.
    const d3fendCypher = `${D}${A}
      MATCH (cm)-[:RESPONDS_WITH]->(dt:MitreDefendTechnique)
      MATCH (dt)--(art)--(ct:MitreAttackTechnique)
      WHERE any(l IN labels(art) WHERE l STARTS WITH 'MitreDefend' AND l ENDS WITH 'Entity')
      MATCH (t)-[:SUBTECHNIQUE_OF*0..1]->(ct)
      MATCH (ctrl:Control)-[:HAS_COUNTERMEASURE]->(cm)
      OPTIONAL MATCH (dt)-[:SUB_TECHNIQUE_OF|ENABLES*0..]->(tac:MitreDefendTactic)
      RETURN exp.id AS exposureId, t.attack_id AS techniqueId, cm.id AS cmId, ctrl.id AS controlId,
             [x IN collect(DISTINCT tac.name) WHERE x IS NOT NULL] AS tactics`;

    const [baseRecs, directRecs, mitRecs, d3fRecs] = await Promise.all([
      this.runRead(baseCypher, { modelId }),
      this.runRead(directCypher, { modelId }),
      this.runRead(mitigationCypher, { modelId }),
      this.runRead(d3fendCypher, { modelId }),
    ]);

    const baseRows: BaseRow[] = baseRecs.map((r) => ({
      elementId: r.get('elementId'),
      elementKind: r.get('elementKind') ?? null,
      exposureId: r.get('exposureId'),
      techniqueId: r.get('techniqueId') ?? null,
      techniqueName: r.get('techniqueName') ?? null,
      techniqueDescription: r.get('techniqueDescription') ?? null,
      tactics: (r.get('tactics') ?? []).filter((x: any) => x != null),
    }));
    const directRows: DirectRow[] = directRecs.map((r) => ({
      exposureId: r.get('exposureId'),
      techniqueId: r.get('techniqueId'),
      cmId: r.get('cmId'),
      controlId: r.get('controlId'),
      relType: r.get('relType'),
    }));
    const mitigationRows: MitigationRow[] = mitRecs.map((r) => ({
      exposureId: r.get('exposureId'),
      techniqueId: r.get('techniqueId'),
      cmId: r.get('cmId'),
      controlId: r.get('controlId'),
    }));
    const d3fendRows: D3fendRow[] = d3fRecs.map((r) => ({
      exposureId: r.get('exposureId'),
      techniqueId: r.get('techniqueId'),
      cmId: r.get('cmId'),
      controlId: r.get('controlId'),
      tactics: (r.get('tactics') ?? []).filter((x: any) => x != null),
    }));

    return aggregateCoverage({
      modelId,
      generatedAt: new Date().toISOString(),
      baseRows,
      directRows,
      mitigationRows,
      d3fendRows,
    });
  }
}

export default DethernetyCoverageToolsModule;
