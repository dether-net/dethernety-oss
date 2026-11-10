import { describe, it, expect } from 'vitest'
import { allTools } from '../tools/index.js'
import { listedTool } from '../tool-listing.js'

/**
 * Every tool's input schema, as listed to a client, uses only string values in `enum` and
 * `const`. Some model providers reject a function declaration holding any other kind (a
 * `z.literal(true)` lists as `enum: [true]`), and then every request of the session fails,
 * not only the call to that tool.
 */

/** Paths to every enum or const value in a JSON schema that is not a string. */
function nonStringEnums(node: unknown, at: string, out: string[]): string[] {
  if (Array.isArray(node)) {
    node.forEach((n, i) => nonStringEnums(n, `${at}[${i}]`, out))
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'enum' && Array.isArray(value)) {
        value.forEach((v, i) => { if (typeof v !== 'string') out.push(`${at}.enum[${i}] = ${JSON.stringify(v)}`) })
      } else if (key === 'const' && typeof value !== 'string') {
        out.push(`${at}.const = ${JSON.stringify(value)}`)
      }
      // A property named "enum" or "const" is a property, not a keyword: walk into it all the same.
      nonStringEnums(value, `${at}.${key}`, out)
    }
  }
  return out
}

describe('tool input schemas', () => {
  it('list only string enum and const values', () => {
    const found = allTools.flatMap((tool) => nonStringEnums(listedTool(tool).inputSchema, tool.name, []))
    expect(found).toEqual([])
  })

  it('the walk finds a non-string enum and const at any depth', () => {
    const schema = { properties: { items: { items: { properties: { a: { enum: [true] }, b: { const: 1 }, c: { enum: ['x'] } } } } } }
    expect(nonStringEnums(schema, 't', [])).toEqual(['t.properties.items.items.properties.a.enum[0] = true', 't.properties.items.items.properties.b.const = 1'])
  })
})
