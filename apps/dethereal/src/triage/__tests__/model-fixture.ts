/**
 * A synthetic platform model the size of a real one, as the model query returns it: 387 exposures on 53 elements of
 * all four kinds, with 200-character reasons, USER-created and stale rows, one definition held by 170 exposures, two
 * definitions that share a display name, and one exposure with 40 long unresolved references. Deterministic.
 */

export interface RawExposure {
  id: string
  name: string
  description: string | null
  type: string | null
  category: string | null
  score: number | null
  attackVector: string | null
  createdBy: string | null
  authoredBy: string | null
  dispositionKind: string | null
  dispositionReason: string | null
  dispositionedBy: string | null
  dispositionedAt: string | null
  dispositionStale: boolean | null
  unresolvedReferences: string[] | null
  exploitedBy: Array<{ attack_id: string | null }>
  exploitedByAtlas: Array<{ atlas_id: string | null }>
}

export const exposureOf = (id: string, over: Partial<RawExposure> = {}): RawExposure => ({
  id, name: `exp ${id}`, description: 'desc', type: '1', category: 'cat', score: 5, attackVector: 'NETWORK',
  createdBy: 'SYSTEM', authoredBy: null, dispositionKind: null, dispositionReason: null, dispositionedBy: null,
  dispositionedAt: null, dispositionStale: null, unresolvedReferences: null,
  exploitedBy: [{ attack_id: 'T1040' }], exploitedByAtlas: [], ...over,
})

const NAMES = [
  'Unencrypted transport', 'Credential stuffing against the login form', 'Server-side request forgery via the fetch proxy',
  'Missing rate limit on the public API', 'Container escape through a privileged pod', 'Secrets in environment variables',
  'Weak session token entropy', 'SQL injection through the search filter', 'Unpatched base image', 'Open admin interface',
  'Log injection', 'Insecure deserialisation of queue messages', 'Overly broad IAM role', 'Unauthenticated metrics endpoint',
]

/** The definition of the n-th exposure after the 170 of the large group. */
function definitionOf(n: number): Pick<RawExposure, 'name' | 'description' | 'type' | 'category' | 'exploitedBy' | 'exploitedByAtlas'> {
  const d = n % 40
  // Definitions 0 and 1 share a display name and differ in their description: two groups, never merged.
  const name = d < 2 ? 'Default credentials' : `${NAMES[d % NAMES.length]} (${d})`
  return {
    name,
    description: `Definition ${d}: ${'the platform computed this exposure from the element attributes. '.repeat(3)}`,
    type: d < 2 ? '0' : String(d % 4),
    category: d < 2 ? 'identity' : ['network', 'identity', 'data', 'runtime'][d % 4]!,
    exploitedBy: [{ attack_id: `T1${String(d).padStart(3, '0')}` }, { attack_id: 'T1078' }],
    exploitedByAtlas: d % 7 === 0 ? [{ atlas_id: 'AML.T0051' }] : [],
  }
}

export interface RawElementFixture {
  id: string
  name: string
  componentClass?: Array<{ id: string; name: string }>
  securityBoundaryClass?: Array<{ id: string; name: string }>
  dataClass?: Array<{ id: string; name: string }>
  dataFlowClass?: Array<{ id: string; name: string }>
  exposures: RawExposure[]
}

/** The model, and the plain facts the tests check against, counted here independently of the fold. */
export function largeModel() {
  const dataItems: RawElementFixture[] = Array.from({ length: 4 }, (_, i) => ({ id: `di-${i}`, name: `Customer record ${i}`, dataClass: [{ id: 'class-data', name: 'Data' }], exposures: [] }))
  const boundaries: RawElementFixture[] = Array.from({ length: 4 }, (_, i) => ({ id: `b-${i}`, name: `Zone ${i}`, securityBoundaryClass: [{ id: 'class-zone', name: 'Zone' }], exposures: [] }))
  const components: RawElementFixture[] = Array.from({ length: 30 }, (_, i) => ({ id: `c-${String(i).padStart(2, '0')}`, name: `Service ${i} of the order platform`, componentClass: [{ id: `class-svc-${i % 5}`, name: `Service class ${i % 5}` }], exposures: [] }))
  const flows: RawElementFixture[] = Array.from({ length: 14 }, (_, i) => ({ id: `f-${String(i).padStart(2, '0')}`, name: `Flow ${i} over HTTPS`, dataFlowClass: [{ id: 'class-flow', name: 'HTTPS' }], exposures: [] }))
  const anchor: RawElementFixture = { id: 'b-anchor', name: 'Internet', securityBoundaryClass: [{ id: 'class-zone', name: 'Zone' }], exposures: [] }
  const quiet: RawElementFixture[] = [
    { id: 'c-quiet-1', name: 'Idle worker', componentClass: [], exposures: [] },
    { id: 'c-quiet-2', name: 'Batch job', componentClass: [], exposures: [] },
  ]
  const withExposures = [...dataItems, anchor, ...boundaries, ...components, ...flows]
  if (withExposures.length !== 53) throw new Error('the fixture holds 53 elements with exposures')

  let n = 0
  const id = () => `exp-${String(n++).padStart(4, '0')}`
  // The large group: 170 members of one definition, spread over the components and flows.
  const spread = [...components, ...flows]
  for (let i = 0; i < 170; i++) {
    spread[i % spread.length]!.exposures.push(exposureOf(id(), {
      name: 'Unencrypted transport', description: 'Traffic crosses a zone in clear text.', type: '2', category: 'network',
      score: 6.5, exploitedBy: [{ attack_id: 'T1040' }, { attack_id: 'T1557' }],
    }))
  }
  // The rest: 217 exposures over 40 definitions and every element, in a fixed rotation of states.
  for (let k = 0; k < 217; k++) {
    const element = withExposures[k % withExposures.length]!
    const state = Math.floor(k / 2) % 10
    const reason = state === 1 || state === 2 || state === 6 ? `Reviewed by the team on the change board; ${'context '.repeat(30)}`.slice(0, 260) : null
    element.exposures.push(exposureOf(id(), {
      ...definitionOf(k),
      score: (k % 11) as number,
      // 1: disposed; 2: disposed and stale; 3: USER-created, affirmed by no one (pending); 4: USER-created, no kind (confirmed);
      // 5: affirmed (confirmed); 6: affirmed and stale; otherwise pending.
      dispositionKind: state === 1 || state === 2 ? 'WAIVED' : state === 3 || state === 5 || state === 6 ? 'AFFIRMED' : null,
      dispositionReason: reason,
      dispositionedBy: state === 1 || state === 2 || state === 5 || state === 6 ? 'operator@example.test' : null,
      dispositionedAt: reason ? '2026-11-01T10:00:00Z' : null,
      dispositionStale: state === 2 || state === 6 ? true : null,
      createdBy: state === 3 || state === 4 ? 'USER' : 'SYSTEM',
      unresolvedReferences: k === 14 ? Array.from({ length: 40 }, (_, j) => `MitreAttackTechnique.attack_id=${String(j).padStart(3, '0')}${'x'.repeat(460)}`) : null,
    }))
  }
  if (n !== 387) throw new Error('the fixture holds 387 exposures')

  const model = {
    id: 'model-large',
    name: 'Order platform',
    dataItems,
    defaultBoundary: [{
      ...anchor,
      allDescendantBoundaries: boundaries,
      allDescendantComponents: [...components, ...quiet],
      allDescendantDataFlows: flows,
    }],
  }
  const all = [...withExposures, ...quiet].flatMap((e) => e.exposures)
  return { model, exposures: all, elementIds: withExposures.map((e) => e.id), quietIds: quiet.map((e) => e.id) }
}
