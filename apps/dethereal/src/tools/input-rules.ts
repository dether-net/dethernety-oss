/**
 * The input rules the action-based tools share: a platform id, a field an action needs or must not be given, and
 * the coded refusal.
 */
import { z } from 'zod'
import type { ToolResult } from './base-tool.js'

/** A platform id as the tools take it. */
export const PLATFORM_ID = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, 'ids contain only [A-Za-z0-9_-], at most 128 characters')

/** A review's or a plan's id: 128 random bits, in hex. */
export const REVIEW_ID = z.string().regex(/^[0-9a-f]{32}$/, 'a review id is 32 hexadecimal characters')
export const PLAN_ID = z.string().regex(/^[0-9a-f]{32}$/, 'a plan id is 32 hexadecimal characters')
/** Over the reply limit, so an over-long reply reaches the worded refusal rather than a schema error. */
export const REPLY_INPUT_MAX = 16_384

/** Within a superRefine: `field` is required for `action`. */
export function need(ctx: z.RefinementCtx, ok: boolean, field: string, action: string): void {
  if (!ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${field}" is required for "${action}"`, path: [field] })
}

/** Within a superRefine: `field` was given, and applies only to `actions`. */
export function only(ctx: z.RefinementCtx, present: boolean, field: string, actions: string): void {
  if (present) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${field}" applies only to ${actions}`, path: [field] })
}

/** A refusal in the coded form: the message, and its code in `data.codes`. */
export function coded<T = Record<string, unknown>>(code: string, message: string, details: Record<string, unknown> = {}): ToolResult<T> {
  return { success: false, error: message, data: { codes: [code], ...details } as T }
}
