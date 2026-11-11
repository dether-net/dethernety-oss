/**
 * Reading the workflow tree, and the content hashes derived from it.
 *
 * The reader returns plain data so everything after it is a pure function of that data: the
 * tests build sources in memory, and the result cannot depend on the order a file system lists
 * a directory in.
 */

import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { WorkflowSource } from './types.js'

/** Files an operating system leaves in a directory; never part of the workflow. */
const OS_NOISE = new Set(['.DS_Store', 'Thumbs.db'])

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** CRLF and lone CR become LF, so a Windows checkout yields the same content and hashes. */
export function normaliseNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/**
 * Every regular file under `dir`, keyed by POSIX path relative to it. A symbolic link or any
 * other non-regular entry is refused: the generator reads only what the tree itself holds.
 */
export function readWorkflow(dir: string): WorkflowSource {
  const root = path.resolve(dir)
  if (!lstatSync(root).isDirectory()) throw new Error(`workflow directory is not a directory: ${root}`)

  const files = new Map<string, string>()
  const walk = (abs: string, rel: string): void => {
    for (const entry of readdirSync(abs)) {
      if (OS_NOISE.has(entry)) continue
      const childAbs = path.join(abs, entry)
      const childRel = rel ? `${rel}/${entry}` : entry
      const stat = lstatSync(childAbs)
      if (stat.isSymbolicLink()) throw new Error(`workflow entry is a symbolic link: ${childRel}`)
      if (stat.isDirectory()) walk(childAbs, childRel)
      else if (stat.isFile()) files.set(childRel, normaliseNewlines(readFileSync(childAbs, 'utf8')))
      else throw new Error(`workflow entry is not a regular file: ${childRel}`)
    }
  }
  walk(root, '')
  return files
}

/** Code-point order, the same in every locale. */
export function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * One hash over a set of files: sha256 of the sorted `path NUL sha256(content)` lines. Used for
 * the workflow (`generatedFrom`) and for a bundle's version-normalised content (`contentHash`).
 */
export function treeHash(files: ReadonlyMap<string, string>): string {
  const lines = [...files.keys()].sort(byCodePoint).map((p) => `${p}\0${sha256(files.get(p)!)}\n`)
  return sha256(lines.join(''))
}
