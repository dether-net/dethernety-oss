import {
  deriveAnalysisClassId,
  deriveClassId,
  ASSISTANT_NAMESPACE_UUID,
  MODULE_CLASS_NAMESPACE_UUID,
} from '@dethernety/dt-module';

describe('identity helpers', () => {
  describe('deriveAnalysisClassId — aegra parity fixtures', () => {
    // These six pairs were verified against the aegra deployment in
    // exploratory testing. The platform's local derivation MUST match
    // aegra's `assistant_id = uuid5(ASSISTANT_NAMESPACE_UUID, graphName)`
    // exactly, otherwise existing AnalysisClass nodes would be orphaned
    // on the next module install.
    const fixtures: Array<[string, string]> = [
      ['Studio: Generate Class', 'e5b244aa-8721-5ffa-a29d-d07ff5f2af9d'],
      ['Studio: Regenerate Section', 'e10e0574-8e73-599a-ae98-642849513e44'],
      ['Studio: Edit Class', '8d67045a-be26-5e53-ad70-e827a79e9e23'],
      ['Studio: Bootstrap Classes', 'df09a7eb-ab32-5ac7-b296-6cf27ff7569d'],
      ['Analysis Copilot', 'c672a797-a90f-5bcf-8936-1fabcf2d23ac'],
      ['Hidden Edges Discovery', '17ba825c-e4ff-52b4-b525-3c470b57eb91'],
    ];

    test.each(fixtures)('"%s" → %s', (graphName, expected) => {
      expect(deriveAnalysisClassId(graphName)).toBe(expected);
    });

    test('namespace UUID is stable and load-bearing', () => {
      // If this changes, every deployed AnalysisClass.id is invalidated.
      expect(ASSISTANT_NAMESPACE_UUID).toBe('6ba7b821-9dad-11d1-80b4-00c04fd430c8');
    });
  });

  describe('deriveClassId — determinism + discrimination', () => {
    test('determinism: same input produces same UUID', () => {
      const a = deriveClassId('myModule', 'componentClasses', 'NAS Appliance');
      const b = deriveClassId('myModule', 'componentClasses', 'NAS Appliance');
      expect(a).toBe(b);
    });

    test('kind discrimination: different classKind produces different UUID', () => {
      const a = deriveClassId('M', 'componentClasses', 'X');
      const b = deriveClassId('M', 'controlClasses', 'X');
      expect(a).not.toBe(b);
    });

    test('module discrimination: different moduleName produces different UUID', () => {
      const a = deriveClassId('moduleA', 'componentClasses', 'X');
      const b = deriveClassId('moduleB', 'componentClasses', 'X');
      expect(a).not.toBe(b);
    });

    test('class discrimination: different className produces different UUID', () => {
      const a = deriveClassId('M', 'componentClasses', 'X');
      const b = deriveClassId('M', 'componentClasses', 'Y');
      expect(a).not.toBe(b);
    });

    test('platform-namespace UUID is stable and load-bearing', () => {
      expect(MODULE_CLASS_NAMESPACE_UUID).toBe('b2c6e3d4-7f8a-4d5e-9c1a-3b4d5e6f7a8b');
    });
  });
});
