import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { TOOL_MANIFEST } from '../tools/manifest.js'

// The package's CLAUDE.md lists the registered tools by category; the manifest is the one source.
const doc = readFileSync(path.resolve(__dirname, '../../CLAUDE.md'), 'utf8')

describe('the CLAUDE.md tool table', () => {
  const section = doc.split(/^### Tools \(`src\/tools\/`\)/m)[1]?.split(/^#{2,3} /m)[0] ?? ''
  const rows = [...section.matchAll(/^\| ([^|]+?) \((\d+)\) \| ([^|]+) \|$/gm)].map((m) => ({
    category: m[1]!,
    count: Number(m[2]),
    tools: m[3]!.split(',').map((t) => t.trim().replace(/`/g, '')),
  }))

  it('lists every registered tool once, with each count and the total right', () => {
    expect(rows.length).toBeGreaterThan(5)
    for (const row of rows) expect(row.tools.length, row.category).toBe(row.count)
    const listed = rows.flatMap((r) => r.tools)
    expect(new Set(listed).size).toBe(listed.length)
    expect([...listed].sort()).toEqual(TOOL_MANIFEST.map((t) => t.name).sort())
    expect(doc).toMatch(new RegExp(`^### Tools \\(\`src/tools/\`\\) — ${TOOL_MANIFEST.length} total$`, 'm'))
  })
})
