/**
 * `@dethernety/dt-module/remediation-honesty`: what remediation copy may not claim, and the check
 * that enforces it.
 *
 * Remediation copy may say "would change this trigger", "the control class this gap concerns",
 * "candidate"; it may never claim that a change fixes, closes or reduces a finding. Having guidance
 * must not read as moving a rating. A caller checks copy before writing it and fails the write on any
 * hit, quoting the terms.
 *
 * Pure: no imports.
 */

/** The terms remediation copy may not use, with the status labels that would claim the same. */
export const FORBIDDEN_REMEDIATION_VERBS = [
  'addresses',
  'closes',
  'fixes',
  'reduces',
  'resolves',
  'mitigates',
  'lowers risk',
  'moves to residual',
  'planned-fixed',
  'remediated',
  'scheduled',
] as const;

/** Rendered wherever sources appear: a difference in citation must not read as a difference in validity. */
export const CITATION_ASYMMETRY_LINE =
  'Citations reflect how the underlying exposure was authored, not the strength, severity, or priority of the finding. Absence of a citation is not absence of basis.';

// A term may not be immediately preceded or followed by a letter, digit or hyphen, so "planned-fixed"
// matches whole, "prefixes" does not contain "fixes", and "rescheduled" does not contain "scheduled".
// The words of a multi-word term may be separated by any run of white space, a line break included.
const BOUNDARY = '[a-z0-9-]';
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PATTERNS: ReadonlyArray<{ term: string; pattern: RegExp }> = FORBIDDEN_REMEDIATION_VERBS.map((term) => ({
  term,
  pattern: new RegExp(`(?<!${BOUNDARY})${term.split(' ').map(escapeRegex).join('\\s+')}(?!${BOUNDARY})`, 'i'),
}));

/**
 * Check composed remediation copy. Returns the distinct forbidden terms found, case-insensitive and
 * word-bounded (an empty array means the copy is clean). The caller fails the write on any hit.
 */
export function lintRemediationText(doc: string): string[] {
  return PATTERNS.filter(({ pattern }) => pattern.test(doc)).map(({ term }) => term);
}
