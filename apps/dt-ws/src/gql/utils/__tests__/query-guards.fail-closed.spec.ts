/**
 * Pins the fail-closed contract of the query-depth guard.
 *
 * buildValidationRules used to do `if (depthRule) rules.push(depthRule)`, so a
 * graphql-depth-limit that stopped returning a rule would have disabled depth
 * limiting with no error and no log — while gql.module.ts kept reporting the
 * configured depth. The package is unmaintained (last released 2018) and its
 * peer range is `graphql: '*'`, so it accepts any resolution; this suite is the
 * thing that turns that class of silent regression into a boot failure.
 *
 * Lives in its own file because jest.mock is hoisted per module: mocking
 * graphql-depth-limit here would otherwise poison the real-behaviour
 * assertions in query-guards.spec.ts.
 */

jest.mock('graphql-depth-limit', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import * as depthLimitModule from 'graphql-depth-limit';
import { buildValidationRules } from '../query-guards';

const mockedDepthLimit = (depthLimitModule as any).default as jest.Mock;

describe('buildValidationRules — fail closed', () => {
  afterEach(() => {
    mockedDepthLimit.mockReset();
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a non-function', {} as unknown],
  ])('throws when the factory returns %s', (_label, returned) => {
    mockedDepthLimit.mockReturnValue(returned);

    expect(() =>
      buildValidationRules({ queryDepthLimit: 10, queryComplexityLimit: 0 }),
    ).toThrow(/graphql-depth-limit did not return a validation rule/);
  });

  it('names the module and the received type so the cause is obvious at boot', () => {
    mockedDepthLimit.mockReturnValue(undefined);

    expect(() =>
      buildValidationRules({ queryDepthLimit: 10, queryComplexityLimit: 0 }),
    ).toThrow(/graphql-depth-limit .*\(got undefined\)/);
  });

  it('still returns the rule when the factory behaves', () => {
    const rule = jest.fn();
    mockedDepthLimit.mockReturnValue(rule);

    const rules = buildValidationRules({ queryDepthLimit: 10, queryComplexityLimit: 0 });

    expect(rules).toEqual([rule]);
    expect(mockedDepthLimit).toHaveBeenCalledWith(10);
  });

  it('leaves the documented opt-out alone: a 0 limit never builds a rule and never throws', () => {
    mockedDepthLimit.mockReturnValue(undefined);

    expect(buildValidationRules({ queryDepthLimit: 0, queryComplexityLimit: 0 })).toEqual([]);
    expect(mockedDepthLimit).not.toHaveBeenCalled();
  });
});
