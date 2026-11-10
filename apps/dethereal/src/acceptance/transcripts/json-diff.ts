/**
 * The leaves that differ between two JSON documents, by JSON pointer (RFC 6901).
 * Objects are compared key by key and arrays index by index; any other value
 * (including null, and a type change) is a leaf. A text that is not JSON is
 * one leaf at the empty pointer.
 */

import { isObject } from '../json.js'
export interface LeafChange {
  pointer: string
  before: unknown
  after: unknown
}

const escape = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1')

/** Parse JSON, or undefined when the text is not JSON. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    return undefined
  }
}

/** Every leaf of `value`, with its pointer. An empty object or array is a leaf of its own. */
export function leaves(value: unknown, pointer = ''): LeafChange[] {
  if (isObject(value) && Object.keys(value).length) return Object.keys(value).sort().flatMap((k) => leaves(value[k], `${pointer}/${escape(k)}`))
  if (Array.isArray(value) && value.length) return value.flatMap((v, i) => leaves(v, `${pointer}/${i}`))
  return [{ pointer, before: undefined, after: value }]
}

/** The changed leaves from `before` to `after` (undefined = absent). */
export function diffJson(before: unknown, after: unknown, pointer = ''): LeafChange[] {
  if (isObject(before) && isObject(after) && (Object.keys(before).length || Object.keys(after).length)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    return keys.flatMap((k) => diffJson(before[k], after[k], `${pointer}/${escape(k)}`))
  }
  if (Array.isArray(before) && Array.isArray(after) && (before.length || after.length)) {
    const n = Math.max(before.length, after.length)
    const out: LeafChange[] = []
    for (let i = 0; i < n; i++) out.push(...diffJson(before[i], after[i], `${pointer}/${i}`))
    return out
  }
  if (before === undefined) return leaves(after, pointer).filter((l) => l.after !== undefined)
  if (after === undefined) return leaves(before, pointer).map((l) => ({ pointer: l.pointer, before: l.after, after: undefined }))
  if (JSON.stringify(before) === JSON.stringify(after)) return []
  // A structure replaced by a scalar (or the other way round): every old and new leaf.
  if (isObject(before) || Array.isArray(before) || isObject(after) || Array.isArray(after)) {
    return [...diffJson(before, undefined, pointer), ...diffJson(undefined, after, pointer)]
  }
  return [{ pointer, before, after }]
}

/** The changes between two file texts: by pointer when both are JSON (or absent), else one whole-file change. */
export function diffTexts(before: string | undefined, after: string | undefined): LeafChange[] {
  const b = before === undefined ? undefined : parseJson(before)
  const a = after === undefined ? undefined : parseJson(after)
  const bOk = before === undefined || b !== undefined
  const aOk = after === undefined || a !== undefined
  if (bOk && aOk) return diffJson(b, a)
  return before === after ? [] : [{ pointer: '', before, after }]
}
