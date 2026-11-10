/**
 * Register a model's current values as the operator's, the way the workflow
 * does: `confirm` in calls of at most 50, each item carrying the value as the
 * model files hold it (a record field from its element, `placement` as shown,
 * a removal as `value: null`). Tests that reach REVIEWED or push call it first.
 */
import fs from 'node:fs'
import path from 'node:path'
import { modelStateTool } from '../../model-state.tool.js'
import { modelStateSettleTool } from '../../model-state-settle.tool.js'

export type Row = {
  group: string; element_id: string; field: string; record?: true; removed?: true; shown?: string; code?: string
  controls_change?: { from: unknown; to: unknown }; flagged?: true
}

export async function registerAll(dir: string): Promise<number> {
  let calls = 0
  for (let round = 0; round < 200; round++) {
    const g = await modelStateTool.run({ action: 'get', directory_path: dir, include: ['unregistered_rows'] } as never, {} as never)
    const data = g.data as { unregistered_changes: { rows: Row[]; rows_total: number }; orphaned_registrations: { total: number } }
    const u = data.unregistered_changes
    if (!u.rows_total) return calls
    if (u.rows.some((r) => r.code)) throw new Error(`unsignable rows: ${JSON.stringify(u.rows.filter((r) => r.code).slice(0, 3))}`)
    const orphaned = data.orphaned_registrations.total
    const r = await modelStateSettleTool.run({
      action: 'settle', directory_path: dir, reply: 'Confirmed.', items: u.rows.slice(0, 50).map((row) => confirmItem(dir, row)),
      ...(orphaned ? { orphaned_acknowledged: orphaned } : {}),
    } as never, {} as never)
    calls++
    if (!r.success) throw new Error(`registering failed: ${r.error} ${JSON.stringify(r.data)}`)
  }
  throw new Error('registering did not converge')
}

/** The `confirm` item for a row, with the value read from the model files. */
export function confirmItem(dir: string, row: Row): Record<string, unknown> {
  // The row's kind as get shows it: a record, or an attribute (said, since a record may share the name).
  const base = { group: row.group, element_id: row.element_id, field: row.field, decision: 'confirm', record: row.record === true }
  if (row.removed) return { ...base, value: null, removed: true }
  // A flagged controls row names the list it replaces, as get showed it.
  const previous = row.flagged && row.controls_change ? { previous: row.controls_change.from === 'not_recorded' ? null : row.controls_change.from } : {}
  return { ...base, value: valueOf(dir, row), ...previous }
}

/** A row's value as the model files hold it. */
export function valueOf(dir: string, row: Row): unknown {
  if (!row.record) {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, 'attributes', row.group, `${row.element_id}.json`), 'utf8'))
    return doc.attributes[row.field]
  }
  if (row.field === 'placement') return row.shown
  return (elementOf(dir, row.group, row.element_id) as Record<string, unknown> | undefined)?.[row.field]
}

function elementOf(dir: string, group: string, id: string): unknown {
  const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
  if (group === 'model') return read('manifest.json').model
  const list = (v: any, key: string) => (Array.isArray(v) ? v : v?.[key] ?? [])
  if (group === 'dataFlows') return list(read('dataflows.json'), 'dataFlows').find((e: any) => e.id === id)
  if (group === 'dataItems') return list(read('data-items.json'), 'dataItems').find((e: any) => e.id === id)
  const found: unknown[] = []
  const walk = (b: any) => {
    if (!b) return
    if (group === 'boundaries' && b.id === id) found.push(b)
    for (const c of b.components ?? []) if (group === 'components' && c.id === id) found.push(c)
    for (const n of b.boundaries ?? []) walk(n)
  }
  walk(read('structure.json').defaultBoundary)
  return found[0]
}
