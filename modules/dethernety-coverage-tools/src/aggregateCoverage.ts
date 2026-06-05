/**
 * Pure aggregator for the graded coverage primitive.
 *
 * The module runs four small, portable Cypher queries (a base anchor query +
 * one per tier) and feeds their flat rows here. Keeping the assembly in a pure
 * function — rather than in deeply-nested Cypher `collect`s — makes the tier
 * merge, the soft/uncovered partition, and the detect/prevent mapping unit-
 * testable against fixtures; the Cypher's *graph* correctness is verified live
 * against a real graph.
 *
 * The output is RAW and DISPOSITION-AGNOSTIC by contract:
 *   - every exposure with its EXPLOITED_BY technique set (incl. soft = no
 *     technique, and uncovered techniques), each technique tagged with its
 *     ATT&CK tactic(s) (the consuming matrix's columns), so the report can bucket;
 *   - per (exposure, technique): which tiers cover it, by which function
 *     (prevent/detect), and which countermeasures + their parent controls.
 * It carries NO disposition filter, NO bucketing, NO percentage, NO single
 * "Covered: N", and NO detect-only reduction — those are the report's job.
 */

export type CoverageTier =
  | 'DIRECT'
  | 'INDIRECT_MITIGATION'
  | 'INDIRECT_D3FEND';

export type CoverageFunction = 'PREVENT' | 'DETECT';

/** One (element, exposure, exploited-technique) row. `techniqueId === null`
 *  marks a soft/unmapped exposure (no EXPLOITED_BY — cannot enter the bridge);
 *  `tactics` are the technique's ATT&CK tactic name(s), inheriting the parent's
 *  via SUBTECHNIQUE_OF (the matrix columns). */
export interface BaseRow {
  elementId: string;
  elementKind: string | null; // Component | DataFlow | SecurityBoundary | Data
  exposureId: string;
  techniqueId: string | null; // EXPLOITED_BY attack_id (e.g. "T1190"); null ⇒ soft
  techniqueName?: string | null; // human-readable ATT&CK name (e.g. "Data from Local System")
  techniqueDescription?: string | null; // full ATT&CK description
  tactics: string[]; // ATT&CK tactic names for this technique (incl. inherited)
}

/** Human-readable technique info, deduped to one entry per technique (so the full
 *  description isn't repeated for every exposure that maps to it). */
export interface TechniqueInfo {
  name: string | null;
  description: string | null;
}

/** A DIRECT-tier covering edge (already element-support-anchored in Cypher,
 *  with parent-technique inheritance applied). */
export interface DirectRow {
  exposureId: string;
  techniqueId: string; // the exposure's own technique (the matrix row)
  cmId: string;
  controlId: string; // the covering countermeasure's parent Control
  relType: string; // COUNTERMEASURE_MITIGATES | _PROTECTS_AGAINST | _DETECTS | _ISOLATES
}

/** An INDIRECT-Mitigation covering edge (catalogue mitigation ⇒ always prevent). */
export interface MitigationRow {
  exposureId: string;
  techniqueId: string;
  cmId: string;
  controlId: string;
}

/** An INDIRECT-D3FEND covering edge (artifact-bridged). function derived from
 *  the MitreDefendTechnique's ENABLES tactics. */
export interface D3fendRow {
  exposureId: string;
  techniqueId: string;
  cmId: string;
  controlId: string;
  tactics: string[]; // MitreDefendTactic names: Detect / Harden / Isolate / ...
}

export interface TierFact {
  tier: CoverageTier;
  function: CoverageFunction;
  countermeasureIds: string[];
  /** Parent controls of the contributing countermeasures — the report's
   *  Residual Risk configured-mismatch signal (a supporting control covering none
   *  of an element's gaps) is derived from these vs. the ledger's
   *  supportingControls. */
  controlIds: string[];
}

export interface TechniqueCoverage {
  techniqueId: string;
  tactics: string[]; // ATT&CK tactic name(s) — the matrix columns this technique fills
  covered: boolean;
  tiers: TierFact[];
}

export interface ExposureCoverage {
  exposureId: string;
  elementId: string;
  elementKind: string | null;
  soft: boolean; // no EXPLOITED_BY technique at all
  techniques: TechniqueCoverage[];
}

export interface CoverageResult {
  modelId: string;
  generatedAt: string;
  exposures: ExposureCoverage[];
  /** attack_id -> { name, description }, deduped across all exposures. */
  techniques: Record<string, TechniqueInfo>;
  meta: {
    exposureCount: number;
    softExposureCount: number;
    /** distinct (exposure, technique) pairs covered at each tier */
    coveredPairsByTier: Record<CoverageTier, number>;
    /** distinct countermeasures contributing a covering edge at each tier */
    countermeasuresByTier: Record<CoverageTier, number>;
  };
}

export interface AggregateInput {
  modelId: string;
  generatedAt: string;
  baseRows: BaseRow[];
  directRows: DirectRow[];
  mitigationRows: MitigationRow[];
  d3fendRows: D3fendRow[];
}

const KEY = (exposureId: string, techniqueId: string) => `${exposureId} ${techniqueId}`;

/**
 * D3FEND function from the defend-technique's tactic(s): Detect ⇒ detective;
 * Harden / Isolate ⇒ preventive. To avoid over-claiming detection,
 * DETECT is asserted ONLY when a `Detect` tactic is present; everything else
 * (incl. tactic-less bridges) reads as PREVENT ("a defensive action, not a
 * detector"). A defend-technique spanning both yields BOTH functions.
 */
function d3fendFunctions(tactics: string[]): CoverageFunction[] {
  const out = new Set<CoverageFunction>();
  const hasDetect = tactics.some((t) => /detect/i.test(t));
  if (hasDetect) out.add('DETECT');
  const hasPreventTactic = tactics.some((t) => /harden|isolate/i.test(t));
  if (hasPreventTactic || !hasDetect) out.add('PREVENT');
  return [...out];
}

/** DIRECT function: only COUNTERMEASURE_DETECTS is detective; the rest prevent. */
function directFunction(relType: string): CoverageFunction {
  return /_DETECTS$/.test(relType) ? 'DETECT' : 'PREVENT';
}

export function aggregateCoverage(input: AggregateInput): CoverageResult {
  const { modelId, generatedAt, baseRows, directRows, mitigationRows, d3fendRows } = input;

  // (exposure, technique) -> tier -> function -> { cms, controls }
  type Contrib = { cms: Set<string>; controls: Set<string> };
  type FnMap = Map<CoverageFunction, Contrib>;
  type TierMap = Map<CoverageTier, FnMap>;
  const cells = new Map<string, TierMap>();

  const add = (
    exposureId: string,
    techniqueId: string,
    tier: CoverageTier,
    fn: CoverageFunction,
    cmId: string,
    controlId: string | null | undefined,
  ) => {
    if (!exposureId || !techniqueId || !cmId) return;
    const k = KEY(exposureId, techniqueId);
    let tm = cells.get(k);
    if (!tm) cells.set(k, (tm = new Map()));
    let fm = tm.get(tier);
    if (!fm) tm.set(tier, (fm = new Map()));
    let c = fm.get(fn);
    if (!c) fm.set(fn, (c = { cms: new Set(), controls: new Set() }));
    c.cms.add(cmId);
    if (controlId) c.controls.add(controlId);
  };

  for (const r of directRows) add(r.exposureId, r.techniqueId, 'DIRECT', directFunction(r.relType), r.cmId, r.controlId);
  for (const r of mitigationRows) add(r.exposureId, r.techniqueId, 'INDIRECT_MITIGATION', 'PREVENT', r.cmId, r.controlId);
  for (const r of d3fendRows) {
    for (const fn of d3fendFunctions(r.tactics ?? [])) {
      add(r.exposureId, r.techniqueId, 'INDIRECT_D3FEND', fn, r.cmId, r.controlId);
    }
  }

  const TIER_ORDER: CoverageTier[] = ['DIRECT', 'INDIRECT_MITIGATION', 'INDIRECT_D3FEND'];
  const FN_ORDER: CoverageFunction[] = ['PREVENT', 'DETECT'];

  const tierFactsFor = (exposureId: string, techniqueId: string): TierFact[] => {
    const tm = cells.get(KEY(exposureId, techniqueId));
    if (!tm) return [];
    const facts: TierFact[] = [];
    for (const tier of TIER_ORDER) {
      const fm = tm.get(tier);
      if (!fm) continue;
      for (const fn of FN_ORDER) {
        const c = fm.get(fn);
        if (c && c.cms.size) {
          facts.push({
            tier,
            function: fn,
            countermeasureIds: [...c.cms].sort(),
            controlIds: [...c.controls].sort(),
          });
        }
      }
    }
    return facts;
  };

  // One ExposureCoverage per distinct exposure; its technique set (each with the
  // union of its tactic names) accumulated across the base rows for that exposure.
  const byExposure = new Map<
    string,
    { elementId: string; elementKind: string | null; techniques: Map<string, Set<string>> }
  >();
  // deduped technique info (name/description) — one entry per technique.
  const techniqueInfo = new Map<string, TechniqueInfo>();
  for (const r of baseRows) {
    let e = byExposure.get(r.exposureId);
    if (!e) byExposure.set(r.exposureId, (e = { elementId: r.elementId, elementKind: r.elementKind, techniques: new Map() }));
    if (r.techniqueId) {
      let tac = e.techniques.get(r.techniqueId);
      if (!tac) e.techniques.set(r.techniqueId, (tac = new Set()));
      for (const name of r.tactics ?? []) if (name) tac.add(name);
      if (!techniqueInfo.has(r.techniqueId)) {
        techniqueInfo.set(r.techniqueId, { name: r.techniqueName ?? null, description: r.techniqueDescription ?? null });
      }
    }
  }

  const exposures: ExposureCoverage[] = [];
  let softExposureCount = 0;
  for (const [exposureId, e] of byExposure) {
    const techniqueIds = [...e.techniques.keys()].sort();
    const soft = techniqueIds.length === 0;
    if (soft) softExposureCount++;
    const techniques: TechniqueCoverage[] = techniqueIds.map((techniqueId) => {
      const tiers = tierFactsFor(exposureId, techniqueId);
      return {
        techniqueId,
        tactics: [...(e.techniques.get(techniqueId) ?? [])].sort(),
        covered: tiers.length > 0,
        tiers,
      };
    });
    exposures.push({ exposureId, elementId: e.elementId, elementKind: e.elementKind, soft, techniques });
  }
  exposures.sort((a, b) => a.exposureId.localeCompare(b.exposureId));

  // meta: distinct covered (exposure,technique) pairs + distinct cms per tier
  const coveredPairsByTier: Record<CoverageTier, number> = { DIRECT: 0, INDIRECT_MITIGATION: 0, INDIRECT_D3FEND: 0 };
  const cmSets: Record<CoverageTier, Set<string>> = { DIRECT: new Set(), INDIRECT_MITIGATION: new Set(), INDIRECT_D3FEND: new Set() };
  for (const tm of cells.values()) {
    for (const tier of TIER_ORDER) {
      const fm = tm.get(tier);
      if (!fm) continue;
      coveredPairsByTier[tier]++;
      for (const c of fm.values()) for (const cm of c.cms) cmSets[tier].add(cm);
    }
  }

  return {
    modelId,
    generatedAt,
    exposures,
    techniques: Object.fromEntries(techniqueInfo),
    meta: {
      exposureCount: exposures.length,
      softExposureCount,
      coveredPairsByTier,
      countermeasuresByTier: {
        DIRECT: cmSets.DIRECT.size,
        INDIRECT_MITIGATION: cmSets.INDIRECT_MITIGATION.size,
        INDIRECT_D3FEND: cmSets.INDIRECT_D3FEND.size,
      },
    },
  };
}
