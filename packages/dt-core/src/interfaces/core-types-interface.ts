export interface User {
  id: string
  email: string
  name: string
}

export interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
}

export interface UserInfo {
  sub: string
  email: string
  name?: string
  preferred_username?: string
  roles?: string[]
  'urn:zitadel:iam:org:project:roles'?: Record<string, any>
}

export interface AuthConfig {
  issuer: string
  clientId: string
  redirectUri: string
  appUrl: string
  nodeEnv: string
}

// Configuration interface for auth store
export interface AuthStoreConfig {
  tokenRefreshThreshold?: number
  pkceCodeVerifierLength?: number
  stateLength?: number
  defaultScope?: string
  maxRetryAttempts?: number
  retryDelay?: number
  enableDebugLogging?: boolean
  roleClaimPath?: string
  permissionClaimPath?: string
}

export interface Element {
  id?: string
  name?: string
  description?: string
}


export interface Folder extends Element {
  id?: string
  name?: string
  description?: string
  parentFolder?: Folder
  childrenFolders?: Folder[]
  models?: Model[]
  controls?: Control[]
}

export interface Control extends Element {
  id?: string;
  name?: string;
  description?: string;
  type?: string;
  category?: string;
  /**
   * Origin/confirmation source for this control reference.
   * Carried on `controls[]` entries in split-file models; round-trips through
   * dt-export-split.ts. See CONTROL_LIBRARY.md and controls-enrichment.md.
   */
  source?: 'discovered' | 'declared' | 'both';
  folder?: Folder
  controlClasses?: Class[]
  /**
   * Polymorphic union of supported elements. Synthesized from the typed fields
   * below by `assignControlToElements()` and `findControls()`. The platform's
   * auto-generated resolver for the `elements` GraphQL field has correctness
   * issues against Memgraph (returns aggregated results across Controls), so
   * dt-core queries the typed fields and merges them locally.
   */
  elements?: Element[]
  supportedComponents?: Element[]
  supportedBoundaries?: Element[]
  supportedDataFlows?: Element[]
  // eslint-disable-next-line no-use-before-define
  countermeasures?: Countermeasure[]
}

export interface Class extends Element {
  id: string
  name: string
  description?: string
  category?: string
  type?: string
  supportedTypes?: string[]
  supportedCategories?: string[]
  module?: Module
  template?: {
    schema?: object | null
    uischema?: object | null
  } | null
  guide?: object | null
}

export interface Module extends Element {
  id: string
  name: string
  description?: string
  componentClasses?: Class[]
  securityBoundaryClasses?: Class[]
  dataFlowClasses?: Class[]
  dataClasses?: Class[]
  controlClasses?: Class[]
  issueClasses?: Class[]
  analysisClasses?: Class[]
  attributes?: string
  template?: string
  // Admin surface (populated by DtClassIdentity.getModulesWithIdentity; absent
  // on the basic DtModule.getModules path). Fields mirror the admin-surface schema.
  idRebindPolicy?: string
  lastInstallStatus?: string
  lastAttemptedInstall?: string
  lastAuthoritativeInstall?: string
  rebindConflicts?: RebindConflictDetail[]
  constraintsHealthy?: boolean
  orphanedComponentClasses?: OrphanedClass[]
  orphanedDataFlowClasses?: OrphanedClass[]
  orphanedSecurityBoundaryClasses?: OrphanedClass[]
  orphanedControlClasses?: OrphanedClass[]
  orphanedDataClasses?: OrphanedClass[]
  orphanedAnalysisClasses?: OrphanedClass[]
  orphanedIssueClasses?: OrphanedClass[]
}

export interface OrphanedClass {
  id: string
  name: string
  orphanedAt?: string
  incomingInstanceCount: number
  incomingInstancesByType?: TypeCount[]
}

export interface RebindConflictDetail {
  className: string
  classKind: string
  dbId: string
  moduleDeclaredId: string
}

export interface TypeCount {
  type: string
  count: number
}

export interface IdentityMigrationReport {
  dryRun: boolean
  totalActions: number
  details: string[]
}

export interface ClassIdentityEvent {
  kind: string
  timestamp: string
  moduleName?: string
  classKind?: string
  className?: string
  // rebind / rebind-conflict
  oldId?: string
  newId?: string
  moduleDeclaredId?: string
  dbId?: string
  policy?: string
  // orphan / revive
  classId?: string
  reason?: string
  // collision
  firstModuleName?: string
  secondModuleName?: string
  collidingId?: string
}

export interface DataItem extends Element {
  id: string
  name: string
  description: string
  dataClass?: { id: string, name: string } | null
  elements?: { id: string }[] | null
  sensitivity?: string
  regulatoryFlags?: string[]
}

export interface ComponentData extends Element {
  id: string
  name: string
  description: string
  type: string
  positionX: number
  positionY: number
  parentBoundary?: { id: string }
  controls?: Control[]
  dataItems?: DataItem[]
  componentClass?: { id: string }[]
  representedModel?: { id: string }[]
  crownJewel?: boolean
}

export interface BoundaryData extends Element {
  id: string
  name: string
  description: string
  positionX?: number
  positionY?: number
  dimensionsWidth?: number
  dimensionsHeight?: number
  dimensionsMinWidth?: number
  dimensionsMinHeight?: number
  parentBoundary?: { id: string }
  controls?: Control[]
  dataItems?: DataItem[]
  securityBoundaryClass?: { id: string }[]
  representedModel?: { id: string }[]
}

export interface DataFlowData extends Element {
  id: string
  name: string
  description: string
  source: { id: string }
  target: { id: string }
  sourceHandle?: string
  targetHandle?: string
  controls?: Control[]
  dataItems?: DataItem[]
}

export interface Model extends Element {
  id: string
  name?: string
  description?: string
  controls?: Control[]
  modules?: Module[]
  folder?: Folder
  // Flat asset-context scope fields, mirroring the platform Model node.
  // The grouped/local snake_case shape is ModelScopeLocal (manifest.schema).
  depth?: string
  modelingIntent?: string
  complianceDrivers?: string[]
  exclusions?: string[]
  trustAssumptions?: string[]
}

export interface DirectDescendant {
  id: string;
  positionX: number;
  positionY: number;
  parentBoundary?: {
    id: string;
    positionX: number;
    positionY: number;
    parentBoundary?: {
      id: string;
      positionX: number;
      positionY: number;
    };
  };
}

export interface MitreAttackTactic extends Element {
  id: string
  name?: string
  description?: string
  attack_id: string
  attack_version?: string
  stix_id: string
  stix_spec_version?: string
}

export interface MitreAttackTechnique extends Element {
  id: string
  name: string
  description: string
  attack_id: string
  attack_version?: string
  stix_id?: string
  stix_spec_version?: string
  stix_type?: string
  subTechniques?: MitreAttackTechnique[]
  parentTechniques?: MitreAttackTechnique[]
  tactics?: MitreAttackTactic[]
}

export interface Exposure extends Element {
  id: string
  name: string
  description?: string
  type?: string
  category?: string
  score?: number
  attackVector?: string
  mitigationSuggestions?: string[]
  detectionMethods?: string[]
  tags?: string[]
  exploitedBy?: MitreAttackTechnique[]
  /** Authorship kind. SYSTEM = module-instantiated. USER = hand-authored. Nullable for legacy data. */
  createdBy?: 'SYSTEM' | 'USER'
  /** For USER findings: the authenticated user id. For SYSTEM: optional module-provided attribution. */
  authoredBy?: string

  // ---------------------------------------------------------------------------
  // Disposition fields. All five are nullable; null
  // means "no active disposition." Set via the structured disposeExposure /
  // clearDisposition mutations (the Supersede flow internally calls disposeExposure
  // with kind: SUPERSEDED). Direct-GraphQL updateExposures is also accepted for
  // the USER-copy-delete companion staleness flip.
  // ---------------------------------------------------------------------------
  /** Structured argument the user authored for treating this finding differently. */
  dispositionKind?: DispositionKind | null
  /** Free-text justification authored by the user. Mandatory when dispositionKind is non-null. */
  dispositionReason?: string | null
  /** JWT sub claim of the user who authored the current disposition. */
  dispositionedBy?: string | null
  /** ISO-8601 string — when the disposition was authored or last re-affirmed. */
  dispositionedAt?: string | null
  /** True when an instantiation attribute changed since the disposition was authored / re-affirmed. */
  dispositionStale?: boolean | null
}

export interface MitreAttackMitigation {
  id: string;
  name: string;
  description: string;
  attack_id: string;
  attackTechniqueMitigated?: MitreAttackTechnique[];
  // eslint-disable-next-line no-use-before-define
  countermeasure?: Countermeasure;
}

export interface MitreDefendTactic extends Element {
  id: string;
  name?: string;
  description?: string;
  attack_id: string;
  d3fendId: string;
}

export interface MitreDefendTechnique extends Element {
  id: string;
  name: string;
  description: string;
  uri: string;
  d3fendId: string;
  subTechniques?: MitreDefendTechnique[];
  parentTechnique?: MitreDefendTechnique;
  // eslint-disable-next-line no-use-before-define
  countermeasures?: Countermeasure[];
}

export interface Countermeasure extends Element {
  id: string;
  name: string;
  description: string;
  type: string;
  category: string;
  score: number;
  references: string;
  addressedExposures: string[];
  tags: string[];
  mitigations?: MitreAttackMitigation[];
  defendedTechniques?: MitreDefendTechnique[];
  control?: Control;
  /** Authorship kind. SYSTEM = module-instantiated. USER = hand-authored. Nullable for legacy data. */
  createdBy?: 'SYSTEM' | 'USER';
  /** For USER findings: the authenticated user id. For SYSTEM: optional module-provided attribution. */
  authoredBy?: string;

  // ---------------------------------------------------------------------------
  // Disposition fields. All five are
  // nullable; null means "no active disposition." Set via the structured
  // disposeCountermeasure / clearCountermeasureDisposition mutations (the
  // Supersede flow internally calls disposeCountermeasure with kind: SUPERSEDED).
  // ---------------------------------------------------------------------------
  /** Structured argument the user authored for treating this finding differently. */
  dispositionKind?: DispositionKind | null;
  /** Free-text justification authored by the user. Mandatory when dispositionKind is non-null. */
  dispositionReason?: string | null;
  /** JWT sub claim of the user who authored the current disposition. */
  dispositionedBy?: string | null;
  /** ISO-8601 string — when the disposition was authored or last re-affirmed. */
  dispositionedAt?: string | null;
  /** True when an instantiation attribute changed since the disposition was authored / re-affirmed. */
  dispositionStale?: boolean | null;
}


// Control Gap Analysis

export interface MitreReference {
  id: string
  name: string
}

export interface ElementReference {
  id: string
  name: string
}

export interface UnmitigatedExposure {
  elementId: string
  elementName: string
  exposureId: string
  exposureName: string
  attackTechniques: MitreReference[]
  recommendedMitigations: MitreReference[]
}

export interface UnaddressableExposure {
  elementId: string
  elementName: string
  exposureId: string
  exposureName: string
  attackTechniques: MitreReference[]
  mitreMitigations: MitreReference[]
}

export interface RecommendedControl {
  controlId?: string
  controlName?: string
  controlClassId: string
  controlClassName: string
  d3fendTechniques: MitreReference[]
  addressesCount: number
  elementsAffected: ElementReference[]
}

export interface CoverageSummary {
  totalExposures: number
  mitigated: number
  unmitigated: number
  unaddressable: number
  configuredCoverage: number
  noMitreChain: number
  coveragePct: number
}

export interface ControlGapsResult {
  unmitigatedExposures: UnmitigatedExposure[]
  unaddressableExposures: UnaddressableExposure[]
  recommendedControls: RecommendedControl[]
  coverageSummary: CoverageSummary
}

// Control Candidate Ranking

export interface ControlClassFit {
  classId: string
  className: string
  moduleId: string
  moduleName: string
  compatible: boolean
  countermeasureCount: number
}

export interface ControlCandidate {
  controlId: string
  controlName: string
  classes: ControlClassFit[]
  totalCountermeasures: number
  assignedElementIds: string[]
}


// Analysis

export interface Analysis extends Element {
  id?: string
  name?: string
  description?: string
  type?: string
  category?: string
  status?: AnalysisStatus
  analysisClass?: AnalysisClass
  model?: Model
  component?: Element
  dataFlow?: Element
  securityBoundary?: Element
  control?: Element
  data?: Element
  element?: Element
}

export interface AnalysisSession {
  sessionId: string;
}

export interface AnalysisStatus {
  createdAt: string;
  updatedAt: string;
  status: string;
  interrupts: object;
  messages: object[];
  metadata: object;
};

export interface AnalysisEvents {
  analysisResponse: {
    analysisResponse: any;
    sessionId: string;
  };
  [event: string]: unknown;
}

export interface AnalysisClass extends Element {
  id: string
  name?: string
  description?: string
  type?: string
  category?: string
}

export interface IssueElement extends Element {
  id: string
  name?: string
  description?: string
  type?: string
  element_type?: string
  category?: string
  model_id?: string
  model_name?: string
  model_description?: string
  exposed_component_id?: string
  exposed_component_name?: string
  exposed_component_description?: string
}

export interface Issue extends Element {
  id: string
  name: string
  description?: string
  type?: string
  category?: string
  attributes?: string
  lastSyncAt?: string
  createdAt?: string
  updatedAt?: string
  syncedAttributes?: any
  issueStatus?: string
  comments?: string[]
  issueClass?: Class
  models?: Element[]
  components?: Element[]
  dataFlows?: Element[]
  securityBoundaries?: Element[]
  controls?: Element[]
  data?: Element[]
  analyses?: Element[]
  exposures?: Element[]
  countermeasures?: Element[]
  elements?: Element[]
  elementsWithExtendedInfo?: IssueElement[]
}

// ============================================================================
// Disposition surface
// String-literal-union types mirror the existing `createdBy: 'SYSTEM' | 'USER'`
// convention. The GraphQL schema-side enums are DispositionKind / DispositionErrorCode.
// ============================================================================

export type DispositionKind =
  | 'NOT_APPLICABLE'
  | 'FALSE_POSITIVE'
  | 'COMPENSATING_CONTROL'
  | 'RISK_ACCEPTED'
  | 'WAIVED'
  | 'SUPERSEDED'
  // The one kind that keeps a finding LIVE (reviewed + confirmed real), not muted.
  | 'AFFIRMED'

export type DispositionErrorCode =
  | 'VALIDATION_ERROR'
  | 'EXPOSURE_NOT_FOUND'
  | 'DATABASE_ERROR'

/**
 * Result envelope returned by the disposeExposure and clearDisposition mutations.
 * On success, errorCode / errorMessage are null and the disposition-* fields
 * echo the state landed on the Exposure (cleared → all five null). On failure,
 * success = false, errorCode set, no graph change persisted.
 */
export interface DispositionMutationResult {
  success: boolean
  exposureId: string
  dispositionKind: DispositionKind | null
  dispositionReason: string | null
  dispositionedBy: string | null
  dispositionedAt: string | null
  dispositionStale: boolean | null
  errorCode: DispositionErrorCode | null
  errorMessage: string | null
}

// ============================================================================
// matchMitreTechniques surface
// MitreMatchType is distinct from the existing matchClasses MatchType enum
// (which uses lowercase values like `exact_name` / `fuzzy_name`). MITRE
// matching cascades through id / name / description / vector tiers.
// ============================================================================

export type MitreKind =
  | 'ATTACK_TECHNIQUE'
  | 'DEFEND_TECHNIQUE'
  | 'ATTACK_MITIGATION'

export type MitreMatchType =
  | 'EXACT_ID'
  | 'PREFIX_ID'
  | 'NAME_MATCH'
  | 'DESCRIPTION_MATCH'
  | 'VECTOR_SIMILARITY'

export type VectorDisabledReason =
  | 'EMBEDDING_DISABLED'
  | 'NO_INDEX_MODULE'
  | 'NO_VECTORS'
  | 'MODEL_MISMATCH'

/** Single query as part of a MatchMitreTechniquesInput.queries batch. */
export interface TechniqueQueryInput {
  query: string
}

/** Input envelope for the matchMitreTechniques query. */
export interface MatchMitreTechniquesInput {
  queries: TechniqueQueryInput[]
  kind: MitreKind
  /** Per-query result cap. Clamped server-side to [1, 50]; default 3. */
  topN?: number
}

/** A single MITRE candidate. Uniform shape across the three MitreKind values. */
export interface MitreCandidate {
  /** T1003 / T1003.001 / D3-PMAD / M1041. */
  mitreId: string
  name: string
  description?: string | null
  /** ATT&CK or D3FEND tactic name (same field, distinct vocabularies). */
  tactic?: string | null
  kind: MitreKind
  matchType: MitreMatchType
  /** Populated for VECTOR_SIMILARITY; null for the deterministic tiers. */
  similarityScore?: number | null
}

/** Candidate list returned for a single TechniqueQueryInput. */
export interface TechniqueQueryMatch {
  /** Echoes the input query string so clients can correlate batched results. */
  query: string
  candidates: MitreCandidate[]
}

/** Result envelope returned by the matchMitreTechniques query. */
export interface MatchMitreTechniquesResult {
  matches: TechniqueQueryMatch[]
  unmatched: string[]
  vectorAvailable: boolean
  /** When vectorAvailable is false, names the specific reason. Null when true. */
  vectorDisabledReason?: VectorDisabledReason | null
}