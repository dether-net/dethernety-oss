/** Why an element's registrations no longer apply: `removed` only when no element of its group has its name. */
import { describe, it, expect } from 'vitest'
import { orphanCause } from '../settlement.js'
import type { ElementRef } from '../gates.js'

const ref = (group: ElementRef['group'], id: string, label: string, name: string, classId = 'cls', type = 'PROCESS'): ElementRef => ({ id, group, label, classId, type, name })
const refs = (...r: ElementRef[]) => new Map(r.map((x) => [x.id, x]))

describe('why an element\'s registrations no longer apply', () => {
  it('says removed only when no element of the group has the name', () => {
    expect(orphanCause('components', 'ROOT/B:App/C:Notifier', 'cls', 'PROCESS', refs(ref('components', 'c1', 'ROOT/B:App/C:Mailer', 'Mailer')))).toBe('removed')
    // A name with a slash, matched as a name, not as a path.
    expect(orphanCause('components', 'ROOT/B:App/C:a/b', 'cls', 'PROCESS', refs(ref('components', 'c1', 'ROOT/B:Other/C:a/b', 'a/b')))).toBe('moved')
  })

  it('tells a class change, a move and a re-pointed flow apart, and says changed otherwise', () => {
    expect(orphanCause('components', 'ROOT/B:App/C:Orders', 'cls-a', 'PROCESS', refs(ref('components', 'c1', 'ROOT/B:App/C:Orders', 'Orders', 'cls-b')))).toBe('reclassified')
    expect(orphanCause('boundaries', 'ROOT/B:Edge/B:DMZ', 'cls', 'BOUNDARY', refs(ref('boundaries', 'b1', 'ROOT/B:DMZ', 'DMZ', 'cls', 'BOUNDARY')))).toBe('moved')
    expect(orphanCause('dataFlows', 'F:ROOT/C:a->ROOT/C:b:Login', 'cls', '', refs(ref('dataFlows', 'f1', 'F:ROOT/C:a->ROOT/C:c:Login', 'Login', 'cls', '')))).toBe('re-pointed')
    expect(orphanCause('dataItems', 'D:Card data#cls-a', 'cls-a', '', refs(ref('dataItems', 'd1', 'D:Card data#cls-b', 'Card data', 'cls-b', '')))).toBe('reclassified')
    // The root boundary is labelled ROOT whatever its name: a class change of it is still a class change.
    expect(orphanCause('boundaries', 'ROOT', 'cls-a', 'BOUNDARY', refs(ref('boundaries', 'b0', 'ROOT', 'Shop', 'cls-b', 'BOUNDARY')))).toBe('reclassified')
    // A flow without a name is still found among the flows without one.
    expect(orphanCause('dataFlows', 'F:ROOT/C:a->ROOT/C:b:', 'cls', '', refs(ref('dataFlows', 'f1', 'F:ROOT/C:a->ROOT/C:c:', '', 'cls', '')))).toBe('re-pointed')
    // An element of that name that was registered under its own label was there already: it is another one.
    const other = ref('components', 'c2', 'ROOT/B:Data/C:Orders', 'Orders')
    const registered = new Set([JSON.stringify([other.label, other.classId, other.type, other.group])])
    expect(orphanCause('components', 'ROOT/B:App/C:Orders', 'cls', 'PROCESS', refs(other), registered)).toBe('removed')
    expect(orphanCause('components', 'ROOT/B:App/C:Orders', 'cls', 'PROCESS', refs(other))).toBe('moved')
    const flow = ref('dataFlows', 'f2', 'F:ROOT/C:x->ROOT/C:y:Login', 'Login', 'cls', '')
    expect(orphanCause('dataFlows', 'F:ROOT/C:a->ROOT/C:b:Login', 'cls', '', refs(flow), new Set([JSON.stringify([flow.label, 'cls', '', 'dataFlows'])]))).toBe('removed')
    // Moved and reclassified at once: the name is there, but no single cause tells it.
    expect(orphanCause('components', 'ROOT/B:App/C:Orders', 'cls-a', 'PROCESS', refs(ref('components', 'c1', 'ROOT/B:Data/C:Orders', 'Orders', 'cls-b')))).toBe('changed')
  })
})
