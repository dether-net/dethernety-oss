/**
 * Denial → fallback content, and the sanitization that makes it safe.
 *
 * When a caller is not entitled (or has no cloud credential), the remote module
 * still returns a *valid* class template/guide — a read-only locked notice the
 * platform renders like any other module template (the UI stays agnostic to the
 * denial). The copy comes from the server-authored denial message when present, else from
 * built-in last-resort constants.
 *
 * Server-authored text is UNTRUSTED. It reaches every deployment without a client
 * release and renders inside trusted product chrome, so this module neutralizes it
 * at the point it is written — the downstream JSONForms renderer is unchangeable.
 * Every server string is escaped to inert plain text and length-bounded here.
 */
import { DenialInfo } from './errors';

const DEFAULT_MAX_LEN = 1000;

/** Zero-width space, inserted to break markdown link/image pivots. */
const ZWSP = '​';

/** Built-in last-resort copy when the denial carries no message. */
const LAST_RESORT_TITLE = 'Content unavailable';
const LAST_RESORT_BODY =
  'This class configuration is not available. If this persists, it may not be accessible ' +
  'for the current account, or the content service may be temporarily unreachable.';

/**
 * Escape (do not merely strip) untrusted text to inert plain text, then bound its
 * length. Neutralizes HTML and markdown link/image syntax so nothing survives a
 * renderer that interprets either.
 */
export function sanitizeText(input: unknown, maxLen: number = DEFAULT_MAX_LEN): string {
  if (typeof input !== 'string') return '';
  let out = input
    // Drop C0/C1 control characters (keeps ordinary printable text and spaces).
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
    // HTML-escape the five significant characters.
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    // Break markdown link/image pivots so `[x](javascript:…)` / `![x](data:…)`
    // cannot form even if the sink interprets markdown.
    .replace(/]\(/g, `]${ZWSP}(`)
    .replace(/!\[/g, `!${ZWSP}[`);
  if (out.length > maxLen) out = out.slice(0, maxLen);
  return out;
}

/**
 * Return the action URL only if it is an absolute `https:` URL whose origin is
 * EXACTLY the service-declared portal origin. Fail closed: no portal origin
 * (e.g. `/meta` never succeeded) ⇒ drop every action URL. Exact-origin equality
 * defeats userinfo (`https://portal@evil.com`) and suffix (`https://portal.evil.com`)
 * tricks that a prefix check would pass.
 */
export function isSafeActionUrl(
  url: string | undefined,
  portalOrigin: string | undefined,
): string | undefined {
  if (!url || !portalOrigin) return undefined;
  let parsed: URL;
  let allowed: URL;
  try {
    parsed = new URL(url);
    allowed = new URL(portalOrigin);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:') return undefined;
  if (parsed.origin !== allowed.origin) return undefined;
  return parsed.toString();
}

/** A JSONForms Label element carrying static, already-sanitized text. */
function label(text: string): Record<string, unknown> {
  return { type: 'Label', text };
}

/**
 * Build a platform-shaped `{schema, uischema}` that JSONForms renders as a
 * read-only notice: static labels, no input controls. All server text is
 * sanitized before it is embedded.
 */
export function buildFallbackTemplate(
  denial?: DenialInfo,
  portalOrigin?: string,
): { schema: Record<string, unknown>; uischema: Record<string, unknown> } {
  const message = denial?.message;
  const title = message?.title ? sanitizeText(message.title, 200) : LAST_RESORT_TITLE;
  const body = message?.body ? sanitizeText(message.body) : LAST_RESORT_BODY;

  const elements: Array<Record<string, unknown>> = [label(title), label(body)];

  const safeUrl = isSafeActionUrl(message?.actionUrl, portalOrigin);
  if (safeUrl) {
    const actionLabel = message?.actionLabel ? sanitizeText(message.actionLabel, 200) : 'Learn more';
    // Sanitize the URL too: an origin match does not encode `[]()`, so a
    // portalOrigin-valid URL like `https://portal/[x](javascript:…)` would
    // otherwise reintroduce a markdown link pivot into the rendered text.
    elements.push(label(`${actionLabel}: ${sanitizeText(safeUrl, 300)}`));
  }

  return {
    schema: { type: 'object', properties: {} },
    uischema: { type: 'VerticalLayout', elements },
  };
}

/**
 * The guide analog — a minimal guide payload carrying the sanitized notice, in the
 * per-option shape the platform's guide renderer expects.
 */
export function buildFallbackGuide(denial?: DenialInfo): unknown {
  const message = denial?.message;
  const title = message?.title ? sanitizeText(message.title, 200) : LAST_RESORT_TITLE;
  const body = message?.body ? sanitizeText(message.body) : LAST_RESORT_BODY;
  return [
    {
      option_name: '_notice',
      option_description: title,
      security_impact: body,
      how_to_obtain: [],
    },
  ];
}
