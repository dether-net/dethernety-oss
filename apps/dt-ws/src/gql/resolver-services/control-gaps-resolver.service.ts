import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j from 'neo4j-driver';
import { AuthorizationService } from '../services/authorization.service';
import { MonitoringService } from '../services/monitoring.service';
import { safeErrorMessage } from '../../common/utils/safe-error-message';

// --- Constants ---

const MAX_ELEMENT_IDS = 500;
const DEFAULT_TOP_N = 3;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// --- Interfaces ---

interface RawExposureRow {
  elementId: string;
  elementName: string;
  elementType: string | null;
  exposureId: string;
  exposureName: string;
  techniques: Array<{ id: string; name: string }>;
  mitigations: Array<{ id: string; name: string }>;
  controlIds: string[];
  anyControlIds: string[];
}

interface ControlGapsInput {
  modelId: string;
  topN?: number;
  limit?: number;
}

// --- Service ---

@Injectable()
export class ControlGapsResolverService {
  private readonly logger = new Logger(ControlGapsResolverService.name);

  constructor(
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
    private readonly configService: ConfigService,
    private readonly authorizationService: AuthorizationService,
    private readonly monitoringService: MonitoringService,
  ) {
    this.logger.log('ControlGapsResolverService initialized');
  }

  // --- Input validation ---

  private validateElementIds(elementIds: string[]): void {
    if (!elementIds || elementIds.length === 0) {
      throw new Error('At least one elementId is required');
    }
    if (elementIds.length > MAX_ELEMENT_IDS) {
      throw new Error(
        `Maximum ${MAX_ELEMENT_IDS} elementIds allowed, received ${elementIds.length}`,
      );
    }
  }

  private validateControlGapsInput(input: ControlGapsInput): {
    modelId: string;
    topN: number;
    limit: number;
  } {
    if (!input.modelId || input.modelId.trim() === '') {
      throw new Error('modelId is required');
    }
    const topN = Math.floor(input.topN ?? DEFAULT_TOP_N);
    const limit = Math.min(Math.floor(input.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
    if (topN < 1) {
      throw new Error('topN must be at least 1');
    }
    if (limit < 1) {
      throw new Error('limit must be at least 1');
    }
    return { modelId: input.modelId, topN, limit };
  }

  // --- Database helpers ---

  private getSession() {
    return this.neo4jDriver.session({
      database: this.configService.get('database.name'),
    });
  }

  // --- controlIdsByElements ---

  private async executeControlIdsByElements(
    elementIds: string[],
  ): Promise<string[]> {
    this.validateElementIds(elementIds);

    const session = this.getSession();
    try {
      const query = `
        MATCH (ctrl:Control)-[:SUPPORTS]->(elem)
        WHERE elem.id IN $elementIds
        RETURN DISTINCT ctrl.id AS controlId
      `;

      const result = await session.executeRead(async (tx: any) => {
        return await tx.run(query, { elementIds });
      });

      return result.records.map((record: any) => record.get('controlId'));
    } finally {
      await session.close();
    }
  }

  // --- controlGaps Phase 1+2: Scope model elements and find gaps ---

  private async executeScopeAndGaps(
    modelId: string,
  ): Promise<RawExposureRow[]> {
    const session = this.getSession();
    try {
      // Model-anchored scope (mirrors model-resolver's ENUMERATE walk): the
      // Model MATCH is the only hard anchor; every containment leg is
      // OPTIONAL, so a boundary-less model still surfaces its Data
      // exposures instead of reporting a misleading "no gaps". collect()
      // drops nulls, so a missing leg contributes []; an element-less model
      // UNWINDs an empty list → zero rows → totalExposures 0, honestly.
      // BELONGS_TO*0..50 covers the top-level boundary itself plus nesting
      // (bounded directed walk — the schema @cypher convention). The
      // structural legs collapse to one row BEFORE the Data leg runs, so
      // model-level Data never cross-joins the boundary/component/flow
      // path rows (peak cardinality stays additive, not multiplicative).
      const query = `
        MATCH (model:Model {id: $modelId})
        OPTIONAL MATCH (model)-[:CONTAINS]->(topB:SecurityBoundary)
        OPTIONAL MATCH (topB)<-[:BELONGS_TO*0..50]-(boundary:SecurityBoundary)
        OPTIONAL MATCH (boundary)<-[:BELONGS_TO]-(comp:Component)
        OPTIONAL MATCH (comp)-[:FLOWS]-(df:DataFlow)
        WITH model, collect(DISTINCT boundary) + collect(DISTINCT comp) + collect(DISTINCT df) AS structural
        OPTIONAL MATCH (model)-[:CONTAINS]->(d:Data)
        WITH structural + collect(DISTINCT d) AS allElements
        UNWIND allElements AS element
        MATCH (element)-[:HAS_EXPOSURE]->(exp:Exposure)
        OPTIONAL MATCH (exp)-[:EXPLOITED_BY]->(tech:MitreAttackTechnique)
        OPTIONAL MATCH (tech)<-[:MITIGATION_DEFENDS_AGAINST_TECHNIQUE]-(mit:MitreAttackMitigation)
        OPTIONAL MATCH (mit)<-[:RESPONDS_WITH]-(cm:Countermeasure)<-[:HAS_COUNTERMEASURE]-(ctrl:Control)-[:SUPPORTS]->(element)
        OPTIONAL MATCH (element)-[:BELONGS_TO]->(parentBnd:SecurityBoundary)<-[:SUPPORTS]-(bndCtrl:Control)-[:HAS_COUNTERMEASURE]->(bndCm:Countermeasure)-[:RESPONDS_WITH]->(mit)
        WITH element, exp,
             collect(DISTINCT CASE WHEN tech IS NOT NULL THEN {id: tech.attack_id, name: tech.name} END) AS techniques,
             collect(DISTINCT CASE WHEN mit IS NOT NULL THEN {id: mit.attack_id, name: mit.name} END) AS mitigations,
             collect(DISTINCT CASE WHEN ctrl IS NOT NULL THEN ctrl.id END) + collect(DISTINCT CASE WHEN bndCtrl IS NOT NULL THEN bndCtrl.id END) AS controlIds
        OPTIONAL MATCH (anyCtrl:Control)-[:SUPPORTS]->(element)
        OPTIONAL MATCH (element)-[:BELONGS_TO]->(anyBnd:SecurityBoundary)<-[:SUPPORTS]-(anyBndCtrl:Control)
        RETURN element.id AS elementId, element.name AS elementName,
               element.type AS elementType,
               exp.id AS exposureId, exp.name AS exposureName,
               techniques, mitigations, controlIds,
               collect(DISTINCT CASE WHEN anyCtrl IS NOT NULL THEN anyCtrl.id END) + collect(DISTINCT CASE WHEN anyBndCtrl IS NOT NULL THEN anyBndCtrl.id END) AS anyControlIds
      `;

      const result = await session.executeRead(async (tx: any) => {
        return await tx.run(query, { modelId });
      });

      return result.records.map((record: any) => ({
        elementId: record.get('elementId'),
        elementName: record.get('elementName'),
        elementType: record.get('elementType') || null,
        exposureId: record.get('exposureId'),
        exposureName: record.get('exposureName'),
        techniques: (record.get('techniques') || []).filter(
          (t: any) => t !== null,
        ),
        mitigations: (record.get('mitigations') || []).filter(
          (m: any) => m !== null,
        ),
        controlIds: (record.get('controlIds') || []).filter(
          (id: any) => id !== null,
        ),
        anyControlIds: (record.get('anyControlIds') || []).filter(
          (id: any) => id !== null,
        ),
      }));
    } finally {
      await session.close();
    }
  }

  // --- controlGaps Phase 2b: Check which mitigations are addressable ---

  private async executeAddressabilityCheck(
    mitigationIds: string[],
  ): Promise<Set<string>> {
    if (mitigationIds.length === 0) return new Set();

    const session = this.getSession();
    try {
      // Orphan-aware: :HAS_CLASS implicitly excludes orphans
      // (HAS_ORPHANED_CLASS) — only active control classes participate
      // in mitigation-mapping.
      const query = `
        MATCH (mit:MitreAttackMitigation)<-[:RESPONDS_WITH]-(cm:Countermeasure)
              -[:IS_COUNTERMEASURE_OF]->(cc:ControlClass)<-[:HAS_CLASS]-(m:Module)
        WHERE mit.attack_id IN $mitigationIds
        RETURN DISTINCT mit.attack_id AS addressableMitigationId
      `;

      const result = await session.executeRead(async (tx: any) => {
        return await tx.run(query, { mitigationIds });
      });

      return new Set(
        result.records.map((record: any) =>
          record.get('addressableMitigationId'),
        ),
      );
    } finally {
      await session.close();
    }
  }

  // --- controlGaps Phase 3: Recommend controls ---

  private async executeRecommendedControls(
    techniqueIds: string[],
    modelElementIds: string[],
    elementTypes: string[],
    topN: number,
  ): Promise<any[]> {
    if (techniqueIds.length === 0) return [];

    const session = this.getSession();
    try {
      // `cc.supportedTypes IS NULL` = compatible with EVERYTHING —
      // deliberate for this discovery/recommendation surface (no module in
      // the catalogue populates supportedTypes today; the strict reading
      // would silence every recommendation). control-candidates-resolver
      // deliberately uses the strict opposite (coalesce → supports nothing)
      // for its ranking surface, where a per-class `compatible` flag
      // carries the nuance. Intentional divergence, ratified 2026-07-18.
      const query = `
        MATCH (ctrl:Control)-[:HAS_COUNTERMEASURE]->(cm:Countermeasure)-[:RESPONDS_WITH]->(mit:MitreAttackMitigation)
              -[:MITIGATION_DEFENDS_AGAINST_TECHNIQUE]->(tech:MitreAttackTechnique)
        WHERE tech.attack_id IN $techniqueIds
        MATCH (ctrl)-[:IS_INSTANCE_OF]->(cc:ControlClass)
        WHERE cc.supportedTypes IS NULL OR ANY(et IN $elementTypes WHERE et IN cc.supportedTypes)
        OPTIONAL MATCH (cm)-[:RESPONDS_WITH]->(d3:MitreDefendTechnique)
        OPTIONAL MATCH (ctrl)-[:SUPPORTS]->(elem)
        WHERE elem.id IN $modelElementIds
        OPTIONAL MATCH (ctrl)-[:SUPPORTS]->(bnd:SecurityBoundary)<-[:BELONGS_TO]-(bndElem)
        WHERE bndElem.id IN $modelElementIds
        WITH ctrl, cc,
             count(DISTINCT tech) AS addressesCount,
             collect(DISTINCT CASE WHEN d3 IS NOT NULL THEN {id: d3.d3fendId, name: d3.name} END) AS d3fendTechniques,
             collect(DISTINCT CASE WHEN elem IS NOT NULL THEN {id: elem.id, name: elem.name} END) +
             collect(DISTINCT CASE WHEN bndElem IS NOT NULL THEN {id: bndElem.id, name: bndElem.name} END) AS elementsAffected
        ORDER BY addressesCount DESC
        LIMIT $topN
        RETURN ctrl.id AS controlId, ctrl.name AS controlName,
               cc.id AS controlClassId, cc.name AS controlClassName,
               d3fendTechniques, addressesCount, elementsAffected
      `;

      // LIMIT must be transmitted as a graph Integer — Memgraph rejects a
      // plain JS number ("Limit on number of returned elements must be an
      // integer.") because Bolt encodes it as Float64. neo4j.int() coerces
      // to the Integer wrapper; Neo4j accepts both shapes, so this is the
      // portable form (same fix as list-classes-resolver's SKIP/LIMIT).
      const result = await session.executeRead(async (tx: any) => {
        return await tx.run(query, {
          techniqueIds,
          modelElementIds,
          elementTypes,
          topN: neo4j.int(topN),
        });
      });

      return result.records.map((record: any) => ({
        controlId: record.get('controlId'),
        controlName: record.get('controlName'),
        controlClassId: record.get('controlClassId'),
        controlClassName: record.get('controlClassName'),
        d3fendTechniques: (record.get('d3fendTechniques') || []).filter(
          (d: any) => d !== null,
        ),
        addressesCount:
          typeof record.get('addressesCount')?.toNumber === 'function'
            ? record.get('addressesCount').toNumber()
            : record.get('addressesCount'),
        elementsAffected: (record.get('elementsAffected') || []).filter(
          (e: any) => e !== null,
        ),
      }));
    } finally {
      await session.close();
    }
  }

  // --- controlGaps orchestration ---

  private emptyResult() {
    return {
      unmitigatedExposures: [],
      unaddressableExposures: [],
      recommendedControls: [],
      coverageSummary: {
        totalExposures: 0,
        mitigated: 0,
        unmitigated: 0,
        unaddressable: 0,
        configuredCoverage: 0,
        noMitreChain: 0,
        coveragePct: 0,
      },
    };
  }

  private async executeControlGaps(input: ControlGapsInput) {
    const { modelId, topN, limit } = this.validateControlGapsInput(input);

    // Phase 1+2: Scope model and find exposure gaps
    const rows = await this.executeScopeAndGaps(modelId);

    if (rows.length === 0) {
      return this.emptyResult();
    }

    // Deduplicate exposures — the query returns one row per (element,
    // exposure) pair, so multiple rows per exposureId only arise when one
    // Exposure node hangs off several elements (atypical). Group by
    // exposureId, OR-accumulating the control signals across rows.
    const exposureMap = new Map<
      string,
      {
        elementId: string;
        elementName: string;
        exposureId: string;
        exposureName: string;
        techniques: Map<string, { id: string; name: string }>;
        mitigations: Map<string, { id: string; name: string }>;
        hasControl: boolean;
        hasAnyControl: boolean;
      }
    >();

    for (const row of rows) {
      let entry = exposureMap.get(row.exposureId);
      if (!entry) {
        entry = {
          elementId: row.elementId,
          elementName: row.elementName,
          exposureId: row.exposureId,
          exposureName: row.exposureName,
          techniques: new Map(),
          mitigations: new Map(),
          hasControl: false,
          hasAnyControl: false,
        };
        exposureMap.set(row.exposureId, entry);
      }

      for (const tech of row.techniques) {
        if (tech.id) entry.techniques.set(tech.id, tech);
      }
      for (const mit of row.mitigations) {
        if (mit.id) entry.mitigations.set(mit.id, mit);
      }
      if (row.controlIds.length > 0) {
        entry.hasControl = true;
      }
      if (row.anyControlIds.length > 0) {
        entry.hasAnyControl = true;
      }
    }

    // Classify exposures into five DISJOINT states — every exposure lands
    // in exactly one, so the coverage summary sums to totalExposures:
    // mitigated: a control on this element addresses its techniques via the MITRE chain
    // configuredCoverage: control assigned but it addresses different techniques
    // unmitigated: no control at all; ≥1 mitigation is addressable by an installed module
    // unaddressable: no control at all and no addressable path — either none
    //   of its MITRE mitigations has installed ControlClass coverage, or
    //   MITRE knows no mitigation for its techniques at all
    // noMitreChain: no ATT&CK technique linked to the exposure
    const totalExposures = exposureMap.size;
    let mitigated = 0;
    let noMitreChain = 0;
    let configuredCoverage = 0;
    type GapCandidate = {
      elementId: string;
      elementName: string;
      exposureId: string;
      exposureName: string;
      techniques: Array<{ id: string; name: string }>;
      mitigations: Array<{ id: string; name: string }>;
    };
    const unmitigatedCandidates: GapCandidate[] = [];
    // configuredCoverage entries stay OUT of the unmitigated/unaddressable
    // buckets and lists (disjointness), but their techniques still feed
    // Phase 3 — the assigned control does not address them, so recommending
    // one that does remains useful.
    const configuredCoverageCandidates: GapCandidate[] = [];

    const toCandidate = (entry: {
      elementId: string;
      elementName: string;
      exposureId: string;
      exposureName: string;
      techniques: Map<string, { id: string; name: string }>;
      mitigations: Map<string, { id: string; name: string }>;
    }): GapCandidate => ({
      elementId: entry.elementId,
      elementName: entry.elementName,
      exposureId: entry.exposureId,
      exposureName: entry.exposureName,
      techniques: Array.from(entry.techniques.values()),
      mitigations: Array.from(entry.mitigations.values()),
    });

    for (const entry of exposureMap.values()) {
      if (entry.techniques.size === 0) {
        noMitreChain++;
        continue;
      }

      if (entry.hasControl) {
        mitigated++;
      } else if (entry.hasAnyControl) {
        // Control assigned to this element but doesn't address this exposure's techniques
        configuredCoverage++;
        if (entry.mitigations.size > 0) {
          configuredCoverageCandidates.push(toCandidate(entry));
        }
      } else {
        // No control at all — a genuine gap, with or without known
        // mitigations. The no-mitigations case partitions into
        // `unaddressable` below (nothing known can address it).
        unmitigatedCandidates.push(toCandidate(entry));
      }
    }

    // Phase 2b: Check addressability of mitigations (both candidate pools —
    // configuredCoverage entries need it for the Phase-3 technique filter)
    const allMitigationIds = [
      ...new Set(
        [...unmitigatedCandidates, ...configuredCoverageCandidates].flatMap(
          (c) => c.mitigations.map((m) => m.id),
        ),
      ),
    ];
    const addressableIds =
      await this.executeAddressabilityCheck(allMitigationIds);

    // Partition the no-control candidates into addressable (unmitigated)
    // and unaddressable. A candidate with zero known mitigations is
    // unaddressable by definition (mitreMitigations: []).
    const unmitigatedExposures: any[] = [];
    const unaddressableExposures: any[] = [];

    for (const candidate of unmitigatedCandidates) {
      const hasAddressable = candidate.mitigations.some((m) =>
        addressableIds.has(m.id),
      );

      if (hasAddressable) {
        unmitigatedExposures.push({
          elementId: candidate.elementId,
          elementName: candidate.elementName,
          exposureId: candidate.exposureId,
          exposureName: candidate.exposureName,
          attackTechniques: candidate.techniques,
          recommendedMitigations: candidate.mitigations.filter((m) =>
            addressableIds.has(m.id),
          ),
        });
      } else {
        unaddressableExposures.push({
          elementId: candidate.elementId,
          elementName: candidate.elementName,
          exposureId: candidate.exposureId,
          exposureName: candidate.exposureName,
          attackTechniques: candidate.techniques,
          mitreMitigations: candidate.mitigations,
        });
      }
    }

    // Phase 3: Recommend controls for unmitigated techniques — from the
    // unmitigated exposures plus the configuredCoverage entries whose
    // mitigations are addressable (their assigned control doesn't cover
    // these techniques, so they deserve recommendations too).
    const unmitigatedTechniqueIds = [
      ...new Set([
        ...unmitigatedExposures.flatMap((e: any) =>
          e.attackTechniques.map((t: any) => t.id),
        ),
        ...configuredCoverageCandidates
          .filter((c) => c.mitigations.some((m) => addressableIds.has(m.id)))
          .flatMap((c) => c.techniques.map((t) => t.id)),
      ]),
    ];
    const modelElementIds = [
      ...new Set(rows.map((r) => r.elementId)),
    ];
    const elementTypes = [
      ...new Set(rows.map((r) => r.elementType).filter(Boolean)),
    ] as string[];
    const recommendedControls = await this.executeRecommendedControls(
      unmitigatedTechniqueIds,
      modelElementIds,
      elementTypes,
      topN,
    );

    // Coverage summary — the five buckets are disjoint and exhaustive:
    // mitigated + configuredCoverage + noMitreChain + unmitigated +
    // unaddressable === totalExposures, exactly.
    const coveragePct =
      totalExposures > 0 ? (mitigated / totalExposures) * 100 : 0;

    return {
      unmitigatedExposures: unmitigatedExposures.slice(0, limit),
      unaddressableExposures: unaddressableExposures.slice(0, limit),
      recommendedControls,
      coverageSummary: {
        totalExposures,
        mitigated,
        unmitigated: unmitigatedExposures.length,
        unaddressable: unaddressableExposures.length,
        configuredCoverage,
        noMitreChain,
        coveragePct: Math.round(coveragePct * 100) / 100,
      },
    };
  }

  // --- Resolver registration ---

  getResolvers() {
    return {
      Query: {
        controlIdsByElements: async (
          _parent: any,
          args: { elementIds: string[] },
          context: any,
        ) => {
          const startTime = Date.now();
          const authContext =
            this.authorizationService.extractAuthContext(context);

          const authResult =
            await this.authorizationService.checkAuthorization(authContext, {
              operationType: 'query',
              operationName: 'controlIdsByElements',
              resourceType: 'Control',
            });

          if (!authResult.allowed) {
            throw new Error(
              `Authorization denied: ${authResult.reason || 'insufficient permissions'}`,
            );
          }

          try {
            const result = await this.executeControlIdsByElements(
              args.elementIds,
            );
            const duration = Date.now() - startTime;

            this.monitoringService.recordOperation({
              operationName: 'controlIdsByElements',
              duration,
              success: true,
              timestamp: new Date(),
              metadata: {
                elementIdCount: args.elementIds.length,
                controlIdCount: result.length,
              },
            });

            this.logger.debug('controlIdsByElements completed', {
              elementIdCount: args.elementIds.length,
              controlIdCount: result.length,
              duration,
            });

            return result;
          } catch (error) {
            const duration = Date.now() - startTime;

            this.monitoringService.recordOperation({
              operationName: 'controlIdsByElements',
              duration,
              success: false,
              timestamp: new Date(),
              metadata: {
                error: safeErrorMessage(error),
              },
            });

            this.logger.error('controlIdsByElements failed', {
              error: safeErrorMessage(error),
              elementIdCount: args.elementIds?.length,
              duration,
            });

            throw error;
          }
        },

        controlGaps: async (
          _parent: any,
          args: { input: ControlGapsInput },
          context: any,
        ) => {
          const startTime = Date.now();
          const authContext =
            this.authorizationService.extractAuthContext(context);

          const authResult =
            await this.authorizationService.checkAuthorization(authContext, {
              operationType: 'query',
              operationName: 'controlGaps',
              resourceType: 'Model',
            });

          if (!authResult.allowed) {
            throw new Error(
              `Authorization denied: ${authResult.reason || 'insufficient permissions'}`,
            );
          }

          try {
            const result = await this.executeControlGaps(args.input);
            const duration = Date.now() - startTime;

            this.monitoringService.recordOperation({
              operationName: 'controlGaps',
              duration,
              success: true,
              timestamp: new Date(),
              metadata: {
                modelId: args.input.modelId,
                totalExposures: result.coverageSummary.totalExposures,
                unmitigated: result.coverageSummary.unmitigated,
                unaddressable: result.coverageSummary.unaddressable,
                coveragePct: result.coverageSummary.coveragePct,
              },
            });

            this.logger.debug('controlGaps completed', {
              modelId: args.input.modelId,
              totalExposures: result.coverageSummary.totalExposures,
              coveragePct: result.coverageSummary.coveragePct,
              duration,
            });

            return result;
          } catch (error) {
            const duration = Date.now() - startTime;

            this.monitoringService.recordOperation({
              operationName: 'controlGaps',
              duration,
              success: false,
              timestamp: new Date(),
              metadata: {
                modelId: args.input?.modelId,
                error: safeErrorMessage(error),
              },
            });

            this.logger.error('controlGaps failed', {
              error: safeErrorMessage(error),
              modelId: args.input?.modelId,
              duration,
            });

            throw error;
          }
        },
      },
    };
  }
}
