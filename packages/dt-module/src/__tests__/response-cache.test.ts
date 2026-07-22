import { describe, it, expect } from 'vitest';
import { ResponseCache } from '../remote/response-cache';

const RESULT = { exposures: [], countermeasures: [] };

describe('ResponseCache.evictPin', () => {
  it('drops every content/schema/eval entry for a pin and leaves other pins intact', () => {
    const cache = new ResponseCache();
    // Two pins' worth of every cache kind.
    cache.putContent('template', 'c1', 'pinA', 't-A');
    cache.putContent('guide', 'c1', 'pinA', 'g-A');
    cache.putSchema('c1', 'pinA', { properties: { a: {} } });
    cache.putEval('c1', 'pinA', 'hashA', RESULT);
    cache.putContent('template', 'c1', 'pinB', 't-B');
    cache.putSchema('c1', 'pinB', { properties: { b: {} } });
    cache.putEval('c1', 'pinB', 'hashB', RESULT);

    cache.evictPin('pinA');

    // pinA gone across all three caches.
    expect(cache.getContent('template', 'c1', 'pinA')).toBeUndefined();
    expect(cache.getContent('guide', 'c1', 'pinA')).toBeUndefined();
    expect(cache.getSchema('c1', 'pinA')).toBeUndefined();
    expect(cache.getEval('c1', 'pinA', 'hashA')).toBeUndefined();

    // pinB untouched.
    expect(cache.getContent('template', 'c1', 'pinB')).toBe('t-B');
    expect(cache.getSchema('c1', 'pinB')).toEqual({ properties: { b: {} } });
    expect(cache.getEval('c1', 'pinB', 'hashB')).toBe(RESULT);
  });
});

describe('ResponseCache — usage-growing caches are bounded', () => {
  it('evicts the oldest eval entry once past the cap; a recent entry survives', () => {
    const cache = new ResponseCache();
    const OVER = 1200; // > MAX_ENTRIES (1000)
    cache.putEval('c1', 'p', 'first', RESULT);
    for (let i = 0; i < OVER; i++) cache.putEval('c1', 'p', `h${i}`, RESULT);
    // The very first entry has been evicted (oldest-out FIFO), the newest is present.
    expect(cache.getEval('c1', 'p', 'first')).toBeUndefined();
    expect(cache.getEval('c1', 'p', `h${OVER - 1}`)).toBe(RESULT);
  });

  it('bounds the entitlement memo per rotated token', () => {
    const cache = new ResponseCache();
    const OVER = 1200;
    cache.rememberEntitled('first-token', 'c1', 'p');
    for (let i = 0; i < OVER; i++) cache.rememberEntitled(`token-${i}`, 'c1', 'p');
    // The oldest token's memo is gone; a recent one is still trusted.
    expect(cache.isEntitled('first-token', 'c1', 'p')).toBe(false);
    expect(cache.isEntitled(`token-${OVER - 1}`, 'c1', 'p')).toBe(true);
  });
});
