/**
 * How a file write in an opaque window reads for one element's gate value: where its new text sits in the file as
 * the replay knew it again decides whether it set the value, passed it by, or leaves the writer unknown.
 */
import { describe, it, expect } from 'vitest'
import { fieldSpan, fileWriteReading, parsePositioned } from '../score/last-writer.js'
import type { FileOp } from '../transcripts/types.js'

const structure = `{
  "defaultBoundary": {
    "id": "root",
    "boundaries": [
      {
        "id": "b1",
        "parentBoundary": { "id": "root" },
        "zone": "INTERNAL",
        "planes": ["MANAGEMENT"],
        "conduits": [{ "peerId": "b2", "direction": "out" }],
        "components": [{ "id": "c1", "crownJewel": true }]
      },
      {
        "id": "b2",
        "parentBoundary": { "id": "b1" },
        "zone": "PUBLIC",
        "components": []
      }
    ]
  }
}`
const replace = (oldString: string, newString: string, replaceAll = false): FileOp => ({ op: 'replace', oldString, newString, replaceAll })

describe('the positions of a value', () => {
  it('reads JSON with positions, and nothing that is not JSON', () => {
    const root = parsePositioned(structure)
    expect(root?.type).toBe('object')
    expect(parsePositioned('{"a": 1,}')).toBeUndefined()
    expect(parsePositioned('{"a": "x\\"y"} trailing')).toBeUndefined()
  })

  it('finds the field in the element\'s own object, not in an object that only names its id', () => {
    // b1 is also named by b2's parentBoundary, which has no zone.
    const span = fieldSpan(structure, 'b1', 'zone')!
    expect(structure.slice(span.start, span.end)).toBe('"zone": "INTERNAL"')
    expect(structure.slice(...Object.values(fieldSpan(structure, 'c1', 'crownJewel')!) as [number, number])).toBe('"crownJewel": true')
    expect(fieldSpan(structure, 'b9', 'zone')).toBeUndefined()
    // Two objects with the same id and the field: which is the element is unknown.
    expect(fieldSpan('[{"id": "x", "zone": "A"}, {"id": "x", "zone": "B"}]', 'x', 'zone')).toBeUndefined()
  })

  it('takes the whole crown-jewel mapping in the scope file', () => {
    const scope = '{\n  "crown_jewel_elements": {\n    "Orders": ["c1"]\n  },\n  "other": 1\n}'
    const span = fieldSpan(scope, 'c1', 'crown_jewel_elements')!
    expect(scope.slice(span.start, span.end)).toBe('"crown_jewel_elements": {\n    "Orders": ["c1"]\n  }')
  })
})

describe('a file write, read for one value', () => {
  it('sets a value its new text holds whole', () => {
    expect(fileWriteReading(replace('"parentBoundary": { "id": "root" },', '"parentBoundary": { "id": "root" },\n        "zone": "INTERNAL",'), 1, structure, 'b1', 'zone', [])).toBe('sets')
    expect(fileWriteReading(replace('"planes": [],', '"planes": ["MANAGEMENT"],'), 1, structure, 'b1', 'planes', [])).toBe('sets')
    expect(fileWriteReading(replace('"conduits": [],', '"conduits": [{ "peerId": "b2", "direction": "out" }],'), 1, structure, 'b1', 'conduits', [])).toBe('sets')
    // A whole-file write that is the file.
    expect(fileWriteReading({ op: 'write', content: structure }, 1, structure, 'b1', 'zone', [])).toBe('sets')
  })

  it('passes a value by when its new text lies elsewhere or already held it', () => {
    // b2's zone.
    expect(fileWriteReading(replace('"id": "b1" },\n        "zone": "INTERNAL"', '"id": "b1" },\n        "zone": "PUBLIC"'), 1, structure, 'b1', 'zone', [])).toBe('passes')
    // The zone line kept as it was, in an edit of the planes beside it.
    expect(fileWriteReading(replace('"zone": "INTERNAL",\n        "planes": [],', '"zone": "INTERNAL",\n        "planes": ["MANAGEMENT"],'), 1, structure, 'b1', 'zone', [])).toBe('passes')
    expect(fileWriteReading(replace('"zone": "INTERNAL",\n        "planes": [],', '"zone": "INTERNAL",\n        "planes": ["MANAGEMENT"],'), 1, structure, 'b1', 'planes', [])).toBe('sets')
  })

  it('leaves the writer unknown when it cannot place the write', () => {
    // A list item added on its own: the edge of its new text cuts the field.
    expect(fileWriteReading(replace('"planes": ["DATA"]', '"planes": ["MANAGEMENT"'), 1, structure, 'b1', 'planes', [])).toBe('stops')
    // New text not in the file: a later write changed it.
    expect(fileWriteReading(replace('a', '"zone": "RESTRICTED"'), 1, structure, 'b1', 'zone', [])).toBe('stops')
    // Every occurrence replaced, or text found twice.
    expect(fileWriteReading(replace('"zone": "PUBLIC"', '"zone": "INTERNAL"', true), 1, structure, 'b1', 'zone', [])).toBe('stops')
    const twice = structure.replace('"zone": "PUBLIC"', '"zone": "INTERNAL"')
    expect(fileWriteReading(replace('"x"', '"zone": "INTERNAL"'), 1, twice, 'b1', 'zone', [])).toBe('stops')
    // A move, a delete, or no operation at all.
    expect(fileWriteReading({ op: 'move', to: 'x.json' }, 1, structure, 'b1', 'zone', [])).toBe('stops')
    expect(fileWriteReading({ op: 'delete' }, 1, structure, 'b1', 'zone', [])).toBe('stops')
    expect(fileWriteReading(undefined, 1, structure, 'b1', 'zone', [])).toBe('stops')
    // A file that is not JSON when known again.
    expect(fileWriteReading(replace('a', 'b'), 1, '{', 'b1', 'zone', [])).toBe('stops')
  })

  it('reads a patch hunk by its context and + lines, per hunk', () => {
    const patch = (hunks: string): FileOp => ({ op: 'patch', hunks })
    const zoneIn = '@@ -6,2 +6,3 @@\n         "parentBoundary": { "id": "root" },\n+        "zone": "INTERNAL",\n         "planes": ["MANAGEMENT"],'
    expect(fileWriteReading(patch(zoneIn), 1, structure, 'b1', 'zone', [])).toBe('sets')
    // A second hunk elsewhere does not change what the first did.
    const b2 = '@@ -16,1 +17,1 @@\n-        "zone": "INTERNAL",\n+        "zone": "PUBLIC",'
    expect(fileWriteReading(patch(`${zoneIn}\n${b2}`), 1, structure, 'b1', 'zone', [])).toBe('sets')
    expect(fileWriteReading(patch(b2.replace('@@ -16,1 +17,1 @@', '@@ -16,2 +17,2 @@\n         "parentBoundary": { "id": "b1" },')), 1, structure, 'b1', 'zone', [])).toBe('passes')
  })
})
