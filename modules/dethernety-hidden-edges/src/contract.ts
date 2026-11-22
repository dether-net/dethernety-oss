/**
 * The answer contract of `hiddenEdgeCandidates`: every answer, a refusal too, carries its contract version, which
 * a client checks before it reads anything else.
 */
import { createHash } from 'node:crypto';

export const MODULE_NAME = 'dethernety-hidden-edges';
export const MODULE_VERSION = '0.1.2';
export const CONTRACT_VERSION = 1;

/** sha256 of the edge-kind table as compiled in, so an answer says which table produced it. */
export function tableHash(raw: unknown): string {
  return createHash('sha256').update(JSON.stringify(raw), 'utf8').digest('hex');
}

/**
 * Refusals are answered in the JSON string, not thrown: the platform replaces every error a module resolver
 * throws with one generic code in production, so a thrown refusal would reach the client as "module failed".
 * Only faults are thrown.
 */
export const REFUSALS = [
  'model_not_found',
  'model_too_large',
  'options_invalid',
  'busy',
  'deadline',
] as const;
export type RefusalCode = (typeof REFUSALS)[number];

export interface Refusal {
  contract: number;
  module: string;
  version: string;
  refusal: { code: RefusalCode; detail?: string };
}

export function refusal(code: RefusalCode, detail?: string): Refusal {
  return { contract: CONTRACT_VERSION, module: MODULE_NAME, version: MODULE_VERSION, refusal: detail ? { code, detail } : { code } };
}
