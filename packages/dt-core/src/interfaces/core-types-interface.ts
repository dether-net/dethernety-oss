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
  folder?: Folder
  controlClasses?: Class[]
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
}

export interface DataItem extends Element {
  id: string
  name: string
  description: string
  dataClass?: { id: string, name: string } | null
  elements?: { id: string }[] | null
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
  mitigationSuggestions?: string[]
  detectionMethods?: string[]
  tags?: string[]
  exploitedBy?: MitreAttackTechnique[]
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