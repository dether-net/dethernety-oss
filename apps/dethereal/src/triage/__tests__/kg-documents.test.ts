/**
 * The knowledge-graph documents against the surface a remotely served knowledge graph declares.
 *
 * That surface is narrower than a locally generated one: some fields exist only where the graph's nodes are local,
 * and a document that selects one fails validation on remote deployments only, which no local platform shows. So
 * both documents are validated here against `KG_REMOTE_SDL`, after the introspection round trip a client sees.
 */
import { describe, it, expect } from 'vitest'
import { KG_REMOTE_SDL } from '@dethernety/dt-module'
import { buildClientSchema, buildSchema, introspectionFromSchema, parse, print, validate, type DocumentNode } from 'graphql'
import { KG_CAPABILITY, KG_CHAIN } from '../kg.js'

/** `KG_REMOTE_SDL` extends `Query`, as a module does, so it needs a root; nothing selects the placeholder. */
const remoteSchema = buildClientSchema(introspectionFromSchema(buildSchema(`type Query { _placeholder: Boolean }\n${KG_REMOTE_SDL}`)))

const documents: Array<[string, DocumentNode]> = [
  ['KG_CHAIN', KG_CHAIN],
  ['KG_CAPABILITY', KG_CAPABILITY],
]

describe('the knowledge-graph documents against the remote surface', () => {
  it.each(documents)('%s validates, fields and arguments both', (_name, doc) => {
    expect(validate(remoteSchema, doc).map((e) => e.message)).toEqual([])
  })

  it('the remote surface still refuses each field it leaves out', () => {
    // Each is a field a local schema has and the remote surface does not, so selecting one must fail here.
    const omitted: Array<[string, string]> = [
      ['KgThreat.classId', '{ kgRules { addresses { classId } } }'],
      ['KgThreat.tactic', '{ kgRules { addresses { tactic } } }'],
      ['KgRule.irVersion', '{ kgRules { irVersion } }'],
      ['KgAttribute.id', '{ kgRules { reads { id } } }'],
      ['KgAttribute.type', '{ kgRules { reads { type } } }'],
      ['KgAttribute.criticality', '{ kgRules { reads { criticality } } }'],
      ['KgAttribute.categoryHint', '{ kgRules { reads { categoryHint } } }'],
      ['KgAttribute.enumValues', '{ kgRules { reads { enumValues } } }'],
    ]
    for (const [field, query] of omitted) {
      expect(validate(remoteSchema, parse(query)).length, `${field} is selectable on the remote surface`).toBeGreaterThan(0)
    }
  })

  it('reaches the rules by class id, and asks the capability rather than sampling rows', () => {
    expect(print(KG_CHAIN).replace(/\s+/g, '')).toContain('kgRules(where:{classId:{eq:$classId}})')
    const capability = print(KG_CAPABILITY).replace(/\s+/g, '')
    expect(capability).toContain('kgCapability{availableentitled')
    expect(capability).not.toContain('kgThreats')
  })
})
