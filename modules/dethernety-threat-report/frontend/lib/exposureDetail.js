// frontend/lib/exposureDetail.js — the view-model for the Exposure Detail dialog.
//
// A residual-risk row shows only an exposure's name + score band + ATT&CK chips.
// This shapes the FULL exposure (description, classification, suggested
// mitigations, detection methods, references, tags) plus the context already in
// hand (the element it sits on, resolved techniques, disposition history, and the
// crown-jewel-route cross-ref) into one read-only view-model — so a single shared
// dialog can render it identically from the Residual Risk ledger, the Component
// Profile, and the Reachability strip.
//
// Honesty contracts carried as flags, not prose (the prose lives in the .vue):
//   - mitigationSuggestions are CLASS-AUTHORED suggestions for this exposure
//     *type* — NOT controls applied to this element, and NEVER a coverage claim.
//     `mitigationsAreSuggestions` marks them so the UI can frame them apart from
//     the element's real supporting controls.
//   - the score band is a TRIAGE SORT-AID (0–10), not a risk rating (`band`).
//   - description/refs are the FROZEN snapshot text — point-in-time, like the rest
//     of the report (this is why the fields are baked into the snapshot, not
//     live-fetched).

import { scoreBand, provenanceOf, dispositionKindLabel } from './aggregateLedger.js'

// Strip HTML tags repeatedly until the string stops changing, so a nested or
// malformed tag can't reconstitute one after a single pass. Rendered as text
// (mustache-escaped) downstream — defense-in-depth, but a complete sanitiser.
// Mirrors TechniqueInfoDialog's stripTags so prose reads the same everywhere.
function stripTags(s) {
  let prev
  do {
    prev = s
    s = s.replace(/<\/?[^>]+>/g, '')
  } while (s !== prev)
  return s
}

// Reduce free-text prose to clean reading text: drop ATT&CK-style citation
// markers, flatten markdown links to their text, strip stray tags, collapse
// whitespace. Returns null for empty/blank input (so the UI hides the section).
export function cleanProse(text) {
  if (text == null) return null
  const noMarkdown = String(text)
    .replace(/\(Citation:[^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  const out = stripTags(noMarkdown)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return out.length ? out : null
}

// Keep only non-empty trimmed strings from a possibly-absent list property.
function cleanList(arr) {
  if (!Array.isArray(arr)) return []
  const seen = new Set()
  const out = []
  for (const item of arr) {
    if (item == null) continue
    const s = String(item).trim()
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

/**
 * Build the Exposure Detail view-model.
 *
 * @param {object} finding   a ledger finding (raw or annotated — band/provenance
 *                           are recomputed defensively if absent).
 * @param {object} [ctx]
 * @param {Array}  [ctx.techniques]  resolved ATT&CK techniques for this exposure
 *                                   ([{ techniqueId, name?, tactics?, description? }]).
 * @param {object} [ctx.element]     the element it sits on ({ id, name, type }).
 * @param {string[]} [ctx.routeJewels]  crown jewels whose flow-route this exposure
 *                                   sits on (from reachability) — the ② cross-ref.
 * @returns {object|null} the view-model, or null when `finding` is absent.
 */
export function buildExposureDetail(finding, ctx = {}) {
  if (!finding || typeof finding !== 'object') return null

  const score = finding.score == null ? null : finding.score
  const band = finding.band ?? scoreBand(score)
  const provenance = finding.provenance ?? provenanceOf(finding)

  const description = cleanProse(finding.description)
  const references = cleanProse(finding.references)
  const mitigationSuggestions = cleanList(finding.mitigationSuggestions)
  const detectionMethods = cleanList(finding.detectionMethods)
  const tags = cleanList(finding.tags)

  const techniques = Array.isArray(ctx.techniques) ? ctx.techniques : []
  const routeJewels = cleanList(ctx.routeJewels)

  const disposition =
    finding.dispositionKind == null
      ? null
      : {
          kind: finding.dispositionKind,
          kindLabel: dispositionKindLabel(finding.dispositionKind),
          reason: finding.dispositionReason ?? null,
          by: finding.dispositionedBy ?? null,
          at: finding.dispositionedAt ?? null,
          stale: finding.dispositionStale === true,
        }

  return {
    id: finding.id,
    name: finding.name ?? '',
    score,
    band, // triage sort-aid, NOT a risk rating
    attackVector: finding.attackVector ?? null,
    type: finding.type ?? null,
    category: finding.category ?? null,
    description,
    references,
    mitigationSuggestions,
    detectionMethods,
    tags,
    techniques,
    provenance, // 'USER' | 'SYSTEM'
    element: ctx.element
      ? { id: ctx.element.id, name: ctx.element.name ?? '', type: ctx.element.type ?? null }
      : null,
    disposition,
    routeJewels,
    onCrownJewelRoute: routeJewels.length > 0,
    // honesty flags — drive section visibility + framing in the .vue
    hasDescription: description != null,
    hasReferences: references != null,
    hasMitigations: mitigationSuggestions.length > 0,
    hasDetection: detectionMethods.length > 0,
    hasTags: tags.length > 0,
    mitigationsAreSuggestions: true, // never "applied controls", never coverage
  }
}
