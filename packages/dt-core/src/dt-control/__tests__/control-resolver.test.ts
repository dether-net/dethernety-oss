/**
 * Control references resolve by id, then by exact name, then by name ignoring case and surrounding spaces. A name step
 * attaches a control only when exactly one matches. A name that only appears inside another control's name, or that
 * contains one, attaches nothing: a reference to "Encryption at rest for S3 buckets" must not pick up a control called
 * "Encryption".
 */
import { describe, it, expect, vi } from 'vitest'
import { ControlResolver, describeUnresolvedControl } from '../control-resolver.js'

const catalog = [
  { id: 'c-enc', name: 'Encryption' },
  { id: 'c-mfa', name: 'Multi-Factor Authentication' },
  { id: 'c-pfw', name: 'Perimeter Firewall' },
  { id: 'c-waf', name: 'Web Application Firewall' },
  { id: 'c-log-a', name: 'Audit Logging' },
  { id: 'c-log-b', name: 'Audit Logging' },
  { id: 'c-tls-1', name: 'TLS Everywhere' },
  { id: 'c-tls-2', name: 'tls everywhere' },
]

const resolverOver = (controls: unknown[]) => new ControlResolver(vi.fn(async () => controls as any))

describe('ControlResolver.resolve', () => {
  it('attaches by id first, whatever the name says', async () => {
    const out = await resolverOver(catalog).resolve([{ id: 'c-mfa', name: 'Encryption' }])
    expect(out).toEqual({ ids: ['c-mfa'], unresolved: [] })
  })

  it('attaches a unique exact name, then a unique name that differs only in case or surrounding spaces', async () => {
    const out = await resolverOver(catalog).resolve([
      { id: 'gone', name: 'Encryption' },
      { name: 'multi-factor authentication' },
      { name: '  Perimeter Firewall ' },
    ])
    expect(out).toEqual({ ids: ['c-enc', 'c-mfa', 'c-pfw'], unresolved: [] })
  })

  it('does not attach a control whose name is only part of the reference, or contains it', async () => {
    const out = await resolverOver(catalog).resolve([{ name: 'Encryption at rest for S3 buckets' }, { name: 'Firewall' }])
    expect(out).toEqual({
      ids: [],
      unresolved: [
        { name: 'Encryption at rest for S3 buckets', reason: 'not_found' },
        { name: 'Firewall', reason: 'not_found' },
      ],
    })
  })

  it('attaches nothing for a name several controls share, and names them', async () => {
    const out = await resolverOver(catalog).resolve([{ name: 'Audit Logging' }, { name: 'TLS EVERYWHERE' }])
    expect(out).toEqual({
      ids: [],
      unresolved: [
        { name: 'Audit Logging', reason: 'ambiguous', candidates: [{ id: 'c-log-a', name: 'Audit Logging' }, { id: 'c-log-b', name: 'Audit Logging' }] },
        { name: 'TLS EVERYWHERE', reason: 'ambiguous', candidates: [{ id: 'c-tls-1', name: 'TLS Everywhere' }, { id: 'c-tls-2', name: 'tls everywhere' }] },
      ],
    })
  })

  it('prefers a unique exact name over the case variants it also has', async () => {
    const out = await resolverOver(catalog).resolve([{ name: 'tls everywhere' }])
    expect(out).toEqual({ ids: ['c-tls-2'], unresolved: [] })
  })

  it('never matches a blank name, on either side', async () => {
    const out = await resolverOver([...catalog, { id: 'c-blank', name: '' }, { id: 'c-space', name: '  ' }]).resolve([
      { name: '' },
      { name: '   ' },
      { id: 'gone' },
      { name: 'Unknown Control' },
    ])
    expect(out.ids).toEqual([])
    expect(out.unresolved).toEqual([
      { reason: 'not_found' },
      { reason: 'not_found' },
      { id: 'gone', reason: 'not_found' },
      { name: 'Unknown Control', reason: 'not_found' },
    ])
  })

  it('ignores catalogue entries without an id', async () => {
    const out = await resolverOver([{ name: 'Encryption' }, ...catalog.slice(1)]).resolve([{ name: 'Encryption' }])
    expect(out).toEqual({ ids: [], unresolved: [{ name: 'Encryption', reason: 'not_found' }] })
  })
})

describe('ControlResolver catalogue', () => {
  it('fetches the controls with no folder and every folder once, deduplicated by id', async () => {
    const load = vi.fn(async (folderId: string | undefined) =>
      (folderId === 'all' ? catalog : catalog.slice(0, 2)) as any,
    )
    const resolver = new ControlResolver(load)
    await resolver.resolve([{ name: 'Encryption' }])
    await resolver.resolve([{ name: 'Perimeter Firewall' }])
    expect(load.mock.calls).toEqual([[undefined], ['all']])
    expect(await resolver.catalog()).toHaveLength(catalog.length)
    expect(await resolver.catalogStatus()).toBe('complete')
  })

  it('reports an incomplete catalogue when only the no-folder fetch worked, and an unavailable one when neither did', async () => {
    const half = new ControlResolver(async (folderId) => {
      if (folderId === 'all') throw new Error('down')
      return catalog as any
    })
    expect(await half.catalogStatus()).toBe('incomplete')
    const none = new ControlResolver(async () => {
      throw new Error('down')
    })
    expect(await none.catalogStatus()).toBe('unavailable')
    // A missing match says nothing about the platform when the catalogue is not complete.
    expect(await none.resolve([{ name: 'Encryption' }])).toEqual({ ids: [], unresolved: [{ name: 'Encryption', reason: 'catalog_unavailable' }] })
    // Nor does a name match: a control in a folder may share the name. Only an id attaches.
    expect(await half.resolve([{ name: 'Encryption' }, { id: 'gone', name: 'Perimeter Firewall' }, { id: 'c-mfa' }])).toEqual({
      ids: ['c-mfa'],
      unresolved: [
        { name: 'Encryption', reason: 'catalog_unavailable' },
        { id: 'gone', name: 'Perimeter Firewall', reason: 'catalog_unavailable' },
      ],
    })
  })
})

describe('describeUnresolvedControl', () => {
  it('names the reference, and the ids of the controls an ambiguous one matched', () => {
    expect(describeUnresolvedControl({ name: 'Firewall', reason: 'not_found' })).toBe('Firewall')
    expect(describeUnresolvedControl({ id: 'gone', reason: 'not_found' })).toBe('gone')
    expect(describeUnresolvedControl({ reason: 'not_found' })).toBe('unnamed')
    expect(
      describeUnresolvedControl({
        name: 'Audit Logging',
        reason: 'ambiguous',
        candidates: [{ id: 'c-log-a', name: 'Audit Logging' }, { id: 'c-log-b', name: 'Audit Logging' }],
      }),
    ).toBe('Audit Logging (2 controls match that name: c-log-a, c-log-b)')
    expect(describeUnresolvedControl({ name: 'Encryption', reason: 'catalog_unavailable' })).toBe(
      'Encryption (the control catalog could not be fetched in full)',
    )
  })
})
