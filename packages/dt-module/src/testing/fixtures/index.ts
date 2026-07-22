/**
 * Fixtures for the in-process mock content service and the contract suite. Every
 * name is fictional (`acme-*`) — these are protocol examples, not real content.
 *
 * One entitled component class of one module at one pinned version, plus the
 * full set of outcome payloads (entitled content + eval, a denial, a recall) the
 * mock replays per scenario.
 */
import { ModuleDocument, EmbeddingsResponse, TemplateResponse, GuideResponse, EvalResponse, MetaResponse } from '../../remote/wire-client';
import { DenialInfo, RecallInfo } from '../../remote/errors';

export const PORTAL_ORIGIN = 'https://portal.acme.example';
export const MODULE_KEY = 'acme-compute';
/** The content-hash pin every request addresses. Opaque and immutable. */
export const PIN = 'sha256:9f2b1c9e7a4d5f6082b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5';
export const MODEL_SLUG = 'all-minilm-l6-v2';

/** The one component class the fixtures serve. Globally unique, stable across versions. */
export const CLASS_ID = 'acme-compute.virtual-machine';

/** Fixture caller tokens, one per entitlement outcome the mock recognizes. */
export const ENTITLED_TOKEN = 'fixture-token-entitled';
export const UNENTITLED_TOKEN = 'fixture-token-unentitled';
export const EXPIRED_TOKEN = 'fixture-token-expired';

export const metaResponse: MetaResponse = {
  service: 'acme-module-content',
  protocolVersions: ['1'],
  // Only the mandatory surfaces — entitlements and knowledge-graph are other modules' surfaces.
  surfaces: ['catalog', 'content', 'eval'],
  portalOrigin: PORTAL_ORIGIN,
};

export const moduleDocument: ModuleDocument = {
  protocol: '1',
  module: {
    name: MODULE_KEY,
    description: 'Compute classes for Acme Cloud',
    icon: 'mdi-server',
    version: '1.4.0',
    contentHash: PIN,
    author: 'Acme',
    idRebindPolicy: 'strict',
    componentClasses: [
      {
        id: CLASS_ID,
        name: 'Virtual Machine',
        description: 'An Acme Cloud compute instance.',
        type: 'PROCESS',
        category: 'compute',
        icon: 'mdi-server',
        properties: {},
      },
    ],
  },
  embeddings: { models: [MODEL_SLUG] },
};

export const embeddingsResponse: EmbeddingsResponse = {
  moduleKey: MODULE_KEY,
  version: PIN,
  model: MODEL_SLUG,
  embeddings: [{ classId: CLASS_ID, vector: [0.0123, -0.0456, 0.0789, -0.0011] }],
};

export const templateResponse: TemplateResponse = {
  classId: CLASS_ID,
  version: PIN,
  template: {
    schema: {
      type: 'object',
      properties: {
        authentication_enabled: { type: 'boolean', title: 'Authentication enabled' },
        tls_version: { type: 'string', title: 'TLS version' },
        open_ports: { type: 'array', title: 'Open ports', items: { type: 'number' } },
      },
    },
    // Normalized (lower-case) at publish — the client passes it through untouched.
    uischema: {
      type: 'VerticalLayout',
      elements: [
        { type: 'Control', scope: '#/properties/authentication_enabled' },
        { type: 'Control', scope: '#/properties/tls_version' },
        { type: 'Control', scope: '#/properties/open_ports' },
      ],
    },
  },
};

export const guideResponse: GuideResponse = {
  classId: CLASS_ID,
  version: PIN,
  guide: {
    authentication_enabled: 'Require authentication on every management interface.',
    tls_version: 'Use TLS 1.2 or higher for all transport.',
    open_ports: 'List every port reachable from outside the trust boundary.',
  },
};

export const evalResponse: EvalResponse = {
  requestId: 'fixture-request-id',
  classId: CLASS_ID,
  version: PIN,
  exposures: [
    {
      name: 'Missing Authentication',
      description: 'The instance accepts management traffic without authentication.',
      type: 'vulnerability',
      category: 'access_control',
      score: 8,
      reference: 'CWE-306',
      attackVector: 'NETWORK',
      tags: ['auth'],
      exploitedBy: [
        {
          label: 'MitreAttackTechnique',
          property: 'attack_id',
          value: 'T1078',
          attributes: { justification: 'Valid accounts abused over an unauthenticated interface.' },
        },
      ],
    },
  ],
  countermeasures: [
    {
      name: 'Enforce MFA',
      description: 'Require multi-factor authentication on management interfaces.',
      type: 'preventive',
      category: 'access_control',
      score: 7,
      tags: [],
      respondsWith: [{ label: 'MitreMitigation', property: 'mitigation_id', value: 'M1032' }],
      mitigates: [{ label: 'MitreAttackTechnique', property: 'attack_id', value: 'T1078' }],
      detects: [],
      protectsAgainst: [],
      isolates: [],
    },
  ],
};

/** The `denial` block a `403 not_entitled` carries. Its `actionUrl` is on the
 * declared `portalOrigin` — the only origin a client may honour. */
export const denial: DenialInfo = {
  subject: { kind: 'class', id: CLASS_ID, moduleKey: MODULE_KEY },
  packages: [{ key: 'acme-cloud', name: 'Acme Cloud Pack' }],
  message: {
    title: 'Acme Cloud Pack — subscription required',
    body: "This class's configuration and analysis are part of the Acme Cloud Pack.",
    actionUrl: `${PORTAL_ORIGIN}/subscribe/acme-cloud`,
    actionLabel: 'View subscription options',
  },
};

/** The `recalled` block a `410 version_recalled` carries. */
export const recall: RecallInfo = {
  moduleKey: MODULE_KEY,
  version: PIN,
  reason: 'Policy omitted a required check; re-evaluate affected elements.',
  recalledAt: '2026-07-19T00:00:00Z',
  supersededBy: 'sha256:0e17aa22bb33cc44dd55ee66ff778899aabbccddeeff00112233445566778899',
};
