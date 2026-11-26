/**
 * The answer contract of `hiddenEdgeCandidates`: every answer, a refusal too, carries its contract version, which
 * a client checks before it reads anything else.
 */
import { createHash } from 'node:crypto';

export const MODULE_NAME = 'dethernety-hidden-edges';
export const MODULE_VERSION = '0.2.0';
/** The contract an answer is in when the caller asks for none. */
export const CONTRACT_VERSION = 1;
/** The contracts this module answers in, by the caller's `options.contract`. */
export const CONTRACTS = [1, 2] as const;
export type Contract = (typeof CONTRACTS)[number];

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

/**
 * A refusal, stamped with the contract the caller asked for once its options parse, and with contract 1 before
 * (so `options_invalid` always arrives as contract 1, which every client reads).
 */
export function refusal(code: RefusalCode, detail?: string, contract: Contract = CONTRACT_VERSION): Refusal {
  return { contract, module: MODULE_NAME, version: MODULE_VERSION, refusal: detail ? { code, detail } : { code } };
}
