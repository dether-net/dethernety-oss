/**
 * The remediation-honesty check: what remediation copy may not claim, matched case-insensitively at word
 * boundaries.
 */
import { describe, it, expect } from 'vitest';
import { CITATION_ASYMMETRY_LINE, FORBIDDEN_REMEDIATION_VERBS, lintRemediationText } from '../remediation-honesty';

describe('lintRemediationText', () => {
  it('catches a claim that a change fixes the issue', () => {
    expect(lintRemediationText('Setting tls_enabled=true — this fixes the issue.')).toEqual(['fixes']);
  });

  it('passes the allowed phrasings and the citation line clean', () => {
    const doc = [
      'Setting audit_log_tamper_evident to true would change this trigger.',
      'The control class this gap concerns: Monitoring & SIEM Service.',
      'Candidate control class (attribute overlap): Data Loss Prevention.',
      CITATION_ASYMMETRY_LINE,
    ].join('\n');
    expect(lintRemediationText(doc)).toEqual([]);
  });

  it('matches at word boundaries, not inside longer words', () => {
    expect(lintRemediationText('URL prefixes are recorded per element.')).toEqual([]);
    expect(lintRemediationText('The run was rescheduled by the operator.')).toEqual([]);
    expect(lintRemediationText('unresolves')).toEqual([]);
    expect(lintRemediationText('followers risk it, and the slowers riskiness')).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(lintRemediationText('This Mitigates the finding.')).toEqual(['mitigates']);
  });

  it('catches the multi-word terms and the status labels', () => {
    expect(lintRemediationText('Applying it lowers risk across the board.')).toEqual(['lowers risk']);
    expect(lintRemediationText('Applying it lowers  risk across the board.')).toEqual(['lowers risk']);
    expect(lintRemediationText('Applying it lowers\nrisk across the board.')).toEqual(['lowers risk']);
    expect(lintRemediationText('The rating moves\tto \n residual once applied.')).toEqual(['moves to residual']);
    expect(lintRemediationText('The rating moves to residual once applied.')).toEqual(['moves to residual']);
    expect(lintRemediationText('Marked planned-fixed pending review.')).toEqual(['planned-fixed']);
    expect(lintRemediationText('The finding is now remediated.')).toEqual(['remediated']);
  });

  it('returns every distinct offender once', () => {
    const hits = lintRemediationText('This closes the gap and resolves the exposure; it also closes another.');
    expect(hits.sort()).toEqual(['closes', 'resolves']);
  });

  it('holds the eleven terms', () => {
    expect([...FORBIDDEN_REMEDIATION_VERBS]).toEqual([
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
    ]);
  });
});
