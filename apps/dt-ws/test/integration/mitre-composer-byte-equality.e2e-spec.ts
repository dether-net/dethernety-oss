import { composeTechniqueText, composeMitigationText } from '@dethernety/dt-module/embedding';

/**
 * M3 — MITRE composer byte-equality (TS side).
 *
 * Sentinel: keep fixtures BYTE-EQUAL with
 * oss/modules/mitre-frameworks/scripts/test_composer_byte_equality.py.
 * If you edit fixtures, edit BOTH files in the same PR — M3 is asserted by
 * parallel tests on a shared fixture set.
 */

type TechniqueInput = { name: string; description?: string; tactic?: string };
type MitigationInput = { name: string; description?: string };

const TECHNIQUE_FIXTURES: { in: TechniqueInput; out: string }[] = [
  {
    in: {
      name: 'OS Credential Dumping',
      description: 'Adversaries may attempt to dump credentials...',
      tactic: 'Credential Access',
    },
    out: 'OS Credential Dumping. Adversaries may attempt to dump credentials.... Tactic: Credential Access.',
  },
  {
    in: { name: 'T1003.001', description: 'LSASS Memory.', tactic: 'Credential Access' },
    out: 'T1003.001. LSASS Memory.. Tactic: Credential Access.',
  },
  {
    in: { name: 'No description', tactic: 'Initial Access' },
    out: 'No description. . Tactic: Initial Access.',
  },
  {
    in: { name: 'No tactic', description: 'Some desc.' },
    out: 'No tactic. Some desc.. Tactic: Unknown.',
  },
  {
    in: { name: 'Bare name' },
    out: 'Bare name. . Tactic: Unknown.',
  },
];

const MITIGATION_FIXTURES: { in: MitigationInput; out: string }[] = [
  {
    in: { name: 'Privileged Account Management', description: 'Manage privileged accounts.' },
    out: 'Privileged Account Management. Manage privileged accounts..',
  },
  {
    in: { name: 'No description' },
    out: 'No description. .',
  },
  {
    in: { name: 'Empty description', description: '' },
    out: 'Empty description. .',
  },
];

describe('M3 — MITRE composer byte-equality (TS side)', () => {
  describe('composeTechniqueText', () => {
    it.each(TECHNIQUE_FIXTURES)(
      'name=$in.name description=$in.description tactic=$in.tactic',
      ({ in: input, out }) => {
        expect(composeTechniqueText(input)).toBe(out);
      },
    );
  });

  describe('composeMitigationText', () => {
    it.each(MITIGATION_FIXTURES)(
      'name=$in.name description=$in.description',
      ({ in: input, out }) => {
        expect(composeMitigationText(input)).toBe(out);
      },
    );
  });
});
