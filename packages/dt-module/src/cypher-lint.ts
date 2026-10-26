/**
 * Static check for one Neo4j 5 rule that Memgraph does not enforce.
 *
 * In a WITH or RETURN that aggregates, an aggregating column may use a variable outside its
 * aggregate only if that variable is also a column of its own (a grouping key) in the same clause.
 * Neo4j refuses `WITH bs + collect(DISTINCT c) AS els` with "Aggregation column contains implicit
 * grouping expressions"; Memgraph accepts it, so the defect only shows on Neo4j. The shape both
 * engines accept collects first and adds the lists in the next clause:
 *
 *   WITH bs, collect(DISTINCT c) AS cs
 *   WITH bs + cs AS els
 *
 * The check reads Cypher text, not a parse tree. It splits each WITH and RETURN into its columns and
 * skips what lies inside an aggregate call. The variable a list comprehension, a quantifier (`any`,
 * `all`, `none`, `single`) or `reduce` declares is local to it, and so is a pattern comprehension's
 * variable unless the statement binds that name before the clause. What is left is the set of
 * variables an aggregating column reads directly, and each must be a grouping key: a column that is
 * the bare variable, or a property access on it.
 *
 * Not checked: outer variables read inside an `EXISTS {}`, `COUNT {}` or `COLLECT {}` subquery,
 * whose body is skipped.
 *
 * Dev and test tooling: the lint suites of the platform and its modules run it over their sources.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface CypherProjection {
  /** `WITH` or `RETURN`. */
  keyword: 'WITH' | 'RETURN';
  /** 1-based line of the keyword in the checked text. */
  line: number;
  /** Each column as written, aliases included, whitespace collapsed. */
  columns: string[];
}

export interface AggregationKeyViolation {
  keyword: 'WITH' | 'RETURN';
  line: number;
  /** The aggregating column, as written. */
  column: string;
  /** The variable (or property access) it uses outside an aggregate without projecting it as a key. */
  variable: string;
}

/** A violation found in a file, with the file's own line. */
export interface FileAggregationKeyViolation extends AggregationKeyViolation {
  file: string;
}

/** A Cypher string found in a source file, with the 1-based line it starts on. */
export interface CypherSource {
  text: string;
  line: number;
}

interface Token {
  kind: 'ident' | 'param' | 'string' | 'number' | 'punct';
  text: string;
  upper: string;
  /** A backtick-quoted identifier: a name, never a keyword. */
  quoted: boolean;
  start: number;
  end: number;
  line: number;
}

const AGGREGATES = new Set([
  'COLLECT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'STDEV', 'STDEVP', 'PERCENTILECONT', 'PERCENTILEDISC',
]);

/** Subquery expressions whose braces hold a query of their own, not part of the column. */
const SUBQUERY_EXPRESSIONS = new Set(['EXISTS', 'COUNT', 'COLLECT']);

const QUANTIFIERS = new Set(['ANY', 'ALL', 'NONE', 'SINGLE']);

/** Words that end a projection when they appear at its own nesting depth. */
const CLAUSE_STARTS = new Set([
  'WHERE', 'ORDER', 'SKIP', 'LIMIT', 'MATCH', 'OPTIONAL', 'WITH', 'RETURN', 'UNWIND', 'CALL', 'CREATE',
  'MERGE', 'SET', 'DELETE', 'DETACH', 'REMOVE', 'FOREACH', 'UNION', 'LOAD', 'FINISH', 'YIELD', 'USE',
]);

/** Expression keywords and literals: never variables. */
const EXPRESSION_WORDS = new Set([
  'AND', 'OR', 'XOR', 'NOT', 'IN', 'IS', 'NULL', 'TRUE', 'FALSE', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'DISTINCT', 'AS', 'STARTS', 'ENDS', 'WITH', 'CONTAINS', 'WHERE',
]);

const OPENERS = new Set(['(', '[', '{']);
const CLOSERS = new Set([')', ']', '}']);

const NUMBER = /0[xX][0-9a-fA-F]+|[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const push = (kind: Token['kind'], start: number, end: number, value = text.slice(start, end), quoted = false) => {
    tokens.push({ kind, text: value, upper: kind === 'string' ? '' : value.toUpperCase(), quoted, start, end, line });
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\n') { line++; i++; continue; }
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      const stop = close < 0 ? text.length : close + 2;
      for (let k = i; k < stop; k++) if (text[k] === '\n') line++;
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const start = i;
      const startLine = line;
      i++;
      while (i < text.length && text[i] !== ch) {
        if (text[i] === '\\') i++;
        else if (text[i] === '\n') line++;
        i++;
      }
      i++;
      tokens.push({ kind: 'string', text: text.slice(start, i), upper: '', quoted: false, start, end: i, line: startLine });
      continue;
    }
    if (ch === '`') {
      const start = i;
      const close = text.indexOf('`', i + 1);
      i = close < 0 ? text.length : close + 1;
      push('ident', start, i, text.slice(start + 1, close < 0 ? text.length : close), true);
      continue;
    }
    if (ch === '$') {
      const start = i;
      i++;
      while (i < text.length && /[A-Za-z0-9_]/.test(text[i])) i++;
      push('param', start, i);
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < text.length && /[A-Za-z0-9_]/.test(text[i])) i++;
      push('ident', start, i);
      continue;
    }
    if (/[0-9]/.test(ch)) {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(text);
      const start = i;
      i += m ? m[0].length : 1;
      push('number', start, i);
      continue;
    }
    push('punct', i, i + 1);
    i++;
  }
  return tokens;
}

const isPunct = (t: Token | undefined, text: string) => t?.kind === 'punct' && t.text === text;
const isWord = (t: Token | undefined, upper: string) => t?.kind === 'ident' && !t.quoted && t.upper === upper;

/**
 * For each token, the nesting depth it sits at, and for a bracket its partner's index (-1 for any
 * other token and for an unbalanced bracket).
 */
function brackets(tokens: Token[]): { depth: number[]; partner: number[] } {
  const depth = new Array<number>(tokens.length).fill(0);
  const partner = new Array<number>(tokens.length).fill(-1);
  const stack: number[] = [];
  tokens.forEach((t, i) => {
    if (t.kind === 'punct' && CLOSERS.has(t.text)) {
      const open = stack.pop();
      if (open !== undefined) {
        partner[open] = i;
        partner[i] = open;
      }
    }
    depth[i] = stack.length;
    if (t.kind === 'punct' && OPENERS.has(t.text)) stack.push(i);
  });
  return { depth, partner };
}

interface Column {
  /** Token index range of the whole column, end exclusive. */
  from: number;
  to: number;
  /** End (exclusive) of the expression, before any `AS alias`. */
  exprTo: number;
}

interface Clause {
  keyword: 'WITH' | 'RETURN';
  /** Index of the keyword token. */
  at: number;
  line: number;
  columns: Column[];
}

/** `STARTS WITH` and `ENDS WITH` are string operators, not clauses. */
const isStringOperator = (tokens: Token[], i: number) =>
  isWord(tokens[i], 'WITH') && (isWord(tokens[i - 1], 'STARTS') || isWord(tokens[i - 1], 'ENDS'));

/** A word written where a name goes: a property (`n.set`), a map key (`{limit: 1}`), an alias (`AS order`). */
function isNamePosition(tokens: Token[], k: number): boolean {
  return isPunct(tokens[k - 1], '.') || isPunct(tokens[k + 1], ':') || isWord(tokens[k - 1], 'AS');
}

function isProjectionKeyword(tokens: Token[], i: number): boolean {
  const t = tokens[i];
  if (!isWord(t, 'WITH') && !isWord(t, 'RETURN')) return false;
  return !isStringOperator(tokens, i) && !isNamePosition(tokens, i) && !isPunct(tokens[i - 1], ':');
}

function parseClauses(tokens: Token[], depth: number[]): Clause[] {
  const clauses: Clause[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!isProjectionKeyword(tokens, i)) continue;
    const base = depth[i];
    let j = i + 1;
    if (isWord(tokens[j], 'DISTINCT')) j++;
    const columns: Column[] = [];
    let from = j;
    let k = j;
    for (; k < tokens.length; k++) {
      const t = tokens[k];
      if (depth[k] < base) break;
      if (depth[k] !== base) continue;
      if (isPunct(t, ';')) break;
      if (t.kind === 'ident' && !t.quoted && CLAUSE_STARTS.has(t.upper)
        && !isNamePosition(tokens, k) && !isStringOperator(tokens, k)) break;
      if (isSplicedClause(tokens, k)) break;
      if (isPunct(t, ',')) {
        columns.push(column(tokens, depth, base, from, k));
        from = k + 1;
      }
    }
    if (k > from) columns.push(column(tokens, depth, base, from, k));
    clauses.push({ keyword: tokens[i].upper as 'WITH' | 'RETURN', at: i, line: tokens[i].line, columns });
  }
  return clauses;
}

/** The placeholder a source interpolation leaves. */
const INTERPOLATION_PLACEHOLDER = '$__interp';

/**
 * An interpolation right after a complete value (`count(e) AS rels ${tail}`) can only splice in a
 * clause: in an expression a value never follows another without an operator or a comma.
 */
function isSplicedClause(tokens: Token[], k: number): boolean {
  const t = tokens[k];
  const prev = tokens[k - 1];
  if (t.kind !== 'param' || t.text !== INTERPOLATION_PLACEHOLDER || !prev) return false;
  if (prev.kind === 'punct') return CLOSERS.has(prev.text);
  if (prev.kind === 'ident') return prev.quoted || !EXPRESSION_WORDS.has(prev.upper);
  return true;
}

function column(tokens: Token[], depth: number[], base: number, from: number, to: number): Column {
  const asAt = to - 2;
  const aliased = asAt > from && isWord(tokens[asAt], 'AS') && depth[asAt] === base;
  return { from, to, exprTo: aliased ? asAt : to };
}

function textOf(source: string, tokens: Token[], from: number, to: number): string {
  if (to <= from) return '';
  return source.slice(tokens[from].start, tokens[to - 1].end).replace(/\s+/g, ' ').trim();
}

/** Normalised form of a token range, for comparing a variable reference with a grouping key. */
function keyOf(tokens: Token[], from: number, to: number): string {
  return tokens.slice(from, to).map((t) => t.text).join(' ');
}

function isAggregateCall(tokens: Token[], i: number): boolean {
  const t = tokens[i];
  return t.kind === 'ident' && !t.quoted && AGGREGATES.has(t.upper) && isPunct(tokens[i + 1], '(')
    && !isPunct(tokens[i - 1], '.');
}

function isSubqueryExpression(tokens: Token[], i: number): boolean {
  const t = tokens[i];
  return t.kind === 'ident' && !t.quoted && SUBQUERY_EXPRESSIONS.has(t.upper) && isPunct(tokens[i + 1], '{');
}

interface Reference {
  /** The variable, then each property access on it: `n`, `n . a`, `n . a . b`. Any one being a key covers it. */
  forms: string[];
}

interface Local {
  name: string;
  /** Token index the scope ends at. */
  until: number;
}

interface ScannedColumn {
  aggregates: boolean;
  refs: Reference[];
}

/** The variables a column reads outside any aggregate, and whether it aggregates at all. */
function scanColumn(
  tokens: Token[], partner: number[], from: number, to: number, boundBefore: ReadonlySet<string>,
): ScannedColumn {
  let aggregates = false;
  const refs: Reference[] = [];
  const locals: Local[] = [];
  /** Innermost open bracket, for telling a map key or value from a label. */
  const open: string[] = [];
  const isLocal = (name: string, at: number) => locals.some((l) => l.name === name && at < l.until);

  for (let i = from; i < to; i++) {
    const t = tokens[i];
    if (t.kind === 'punct') {
      if (OPENERS.has(t.text)) {
        open.push(t.text);
        if (t.text === '[') locals.push(...comprehensionLocals(tokens, partner, i, boundBefore));
      } else if (CLOSERS.has(t.text)) {
        open.pop();
      }
      continue;
    }
    if (t.kind !== 'ident') continue;
    const aggregate = isAggregateCall(tokens, i);
    if (aggregate || isSubqueryExpression(tokens, i)) {
      if (aggregate) aggregates = true;
      const close = partner[i + 1];
      i = close < 0 ? to : close;
      continue;
    }
    if (!t.quoted && (QUANTIFIERS.has(t.upper) || t.upper === 'REDUCE') && isPunct(tokens[i + 1], '(')) {
      locals.push(...quantifierLocals(tokens, partner, i));
    }
    if (!t.quoted && EXPRESSION_WORDS.has(t.upper)) continue;
    if (isPunct(tokens[i - 1], '.')) continue;
    const inMap = open[open.length - 1] === '{';
    if (isPunct(tokens[i - 1], ':') && !inMap) continue;
    if (isPunct(tokens[i + 1], ':') && inMap) continue;
    if (isFunctionName(tokens, i)) continue;
    if (isLocal(t.text, i)) continue;
    const forms = [t.text];
    for (let k = i + 1; isPunct(tokens[k], '.') && tokens[k + 1]?.kind === 'ident'; k += 2) {
      forms.push(keyOf(tokens, i, k + 2));
    }
    refs.push({ forms });
  }
  return { aggregates, refs };
}

/** `fn(`, `ns.fn(`, `a.b.fn(`: the identifier is part of a function name. */
function isFunctionName(tokens: Token[], i: number): boolean {
  let k = i + 1;
  while (isPunct(tokens[k], '.') && tokens[k + 1]?.kind === 'ident') k += 2;
  return isPunct(tokens[k], '(');
}

/**
 * `[x IN …]` declares `x`. `[(a)-->(b) | …]` declares the pattern's variables, except a name the
 * statement binds before the clause: that one is the outer variable, read by the pattern. A named
 * path, `[p = (a)-->(b) | …]`, declares `p` too.
 */
function comprehensionLocals(tokens: Token[], partner: number[], i: number, boundBefore: ReadonlySet<string>): Local[] {
  const until = partner[i] < 0 ? tokens.length : partner[i];
  const first = tokens[i + 1];
  if (first?.kind === 'ident' && isWord(tokens[i + 2], 'IN')) return [{ name: first.text, until }];
  const named = first?.kind === 'ident' && isPunct(tokens[i + 2], '=') && isPunct(tokens[i + 3], '(');
  const pattern = named ? i + 3 : i + 1;
  if (!isPunct(tokens[pattern], '(')) return [];
  const locals: Local[] = named ? [{ name: first.text, until }] : [];
  for (let k = pattern; k < until; k++) {
    const t = tokens[k];
    if (isPunct(t, '|') || isWord(t, 'WHERE')) break;
    if (t.kind === 'ident' && (isPunct(tokens[k - 1], '(') || isPunct(tokens[k - 1], '[')) && !boundBefore.has(t.text)) {
      locals.push({ name: t.text, until });
    }
  }
  return locals;
}

/**
 * `any(x IN …)` and the other quantifiers declare `x`; `reduce(acc = …, x IN …)` declares `acc` and
 * `x`. Only those declaring positions count: a name compared later in the body is a reference.
 */
function quantifierLocals(tokens: Token[], partner: number[], i: number): Local[] {
  const open = i + 1;
  const until = partner[open] < 0 ? tokens.length : partner[open];
  const declared = (k: number, marker: (t: Token | undefined) => boolean): Local[] =>
    tokens[k]?.kind === 'ident' && marker(tokens[k + 1]) ? [{ name: tokens[k].text, until }] : [];
  if (!isWord(tokens[i], 'REDUCE')) return declared(open + 1, (t) => isWord(t, 'IN'));
  const locals = declared(open + 1, (t) => isPunct(t, '='));
  for (let k = open + 1; k < until; k++) {
    if (OPENERS.has(tokens[k].text) && tokens[k].kind === 'punct') {
      k = partner[k] < 0 ? until : partner[k];
      continue;
    }
    if (isPunct(tokens[k], ',')) return [...locals, ...declared(k + 1, (t) => isWord(t, 'IN'))];
  }
  return locals;
}

/**
 * Names written as variables before token `end`: the statement's bindings so far, as far as text can
 * tell. Properties, labels, map keys and the variables comprehensions and quantifiers declare (within
 * their brackets) are left out; any other earlier use of a name counts as a binding.
 */
function namesBefore(tokens: Token[], partner: number[], end: number): Set<string> {
  const names = new Set<string>();
  const open: string[] = [];
  const declared: Local[] = [];
  for (let k = 0; k < end; k++) {
    const t = tokens[k];
    if (t.kind === 'punct') {
      if (OPENERS.has(t.text)) open.push(t.text);
      else if (CLOSERS.has(t.text)) open.pop();
      continue;
    }
    if (t.kind !== 'ident' || isPunct(tokens[k - 1], '.') || isPunct(tokens[k - 1], ':')) continue;
    if (isPunct(tokens[k + 1], ':') && open[open.length - 1] === '{') continue;
    if ((isPunct(tokens[k - 1], '[') || isPunct(tokens[k - 1], '(')) && isWord(tokens[k + 1], 'IN')) {
      declared.push({ name: t.text, until: partner[k - 1] < 0 ? tokens.length : partner[k - 1] });
      continue;
    }
    if (declared.some((d) => d.name === t.text && k < d.until)) continue;
    names.add(t.text);
  }
  return names;
}

/** Every WITH and RETURN in `cypher`, split into its columns. */
export function cypherProjections(cypher: string): CypherProjection[] {
  const tokens = tokenize(cypher);
  return parseClauses(tokens, brackets(tokens).depth).map((c) => ({
    keyword: c.keyword,
    line: c.line,
    columns: c.columns.map((col) => textOf(cypher, tokens, col.from, col.to)),
  }));
}

/**
 * Each place where an aggregating column uses a variable outside its aggregate that the same clause
 * does not project as a grouping key. Empty when the statement is legal on Neo4j by this rule.
 */
export function aggregationKeyViolations(cypher: string): AggregationKeyViolation[] {
  const tokens = tokenize(cypher);
  const { depth, partner } = brackets(tokens);
  const violations: AggregationKeyViolation[] = [];
  for (const clause of parseClauses(tokens, depth)) {
    const boundBefore = namesBefore(tokens, partner, clause.at);
    const scanned = clause.columns.map((col) => ({
      col, ...scanColumn(tokens, partner, col.from, col.exprTo, boundBefore),
    }));
    if (!scanned.some((s) => s.aggregates)) continue;
    if (scanned.some((s) => s.col.exprTo - s.col.from === 1 && tokens[s.col.from].text === '*')) continue;
    const keys = new Set(scanned.filter((s) => !s.aggregates).map((s) => keyOf(tokens, s.col.from, s.col.exprTo)));
    for (const s of scanned) {
      if (!s.aggregates) continue;
      const seen = new Set<string>();
      for (const ref of s.refs) {
        const access = ref.forms[ref.forms.length - 1];
        if (ref.forms.some((f) => keys.has(f)) || seen.has(access)) continue;
        seen.add(access);
        violations.push({
          keyword: clause.keyword,
          line: clause.line,
          column: textOf(cypher, tokens, s.col.from, s.col.to),
          variable: access.replace(/ \. /g, '.'),
        });
      }
    }
  }
  return violations;
}

/** Whether a string from source code reads as Cypher rather than prose or an identifier. */
function looksLikeCypher(text: string): boolean {
  return /\b(WITH|RETURN)\b/.test(text) && /\b(MATCH|UNWIND|MERGE|CREATE|CALL|AS)\b/.test(text);
}

/** 1-based line of each offset in one source, from its line starts. */
function lineIndex(source: string): (offset: number) => number {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** `\n`, `\t` and `\r` escapes read as whitespace, so `'MATCH (n)\nWITH n'` splits into its words. */
const unescapeWhitespace = (text: string) => text.replace(/\\[ntr]/g, ' ');

interface SourceScan {
  source: string;
  end: number;
  lineAt: (offset: number) => number;
  found: CypherSource[];
}

/**
 * The Cypher strings in a TypeScript or JavaScript source: every template literal and quoted string
 * that reads as Cypher. A `${…}` interpolation becomes the parameter `$__interp`, so a fragment
 * spliced in is checked where it is defined, not where it is used; one that follows a complete value
 * ends the clause it follows.
 */
export function cypherStringsInSource(source: string): CypherSource[] {
  const scan: SourceScan = { source, end: source.length, lineAt: lineIndex(source), found: [] };
  scanCode(scan, 0, false);
  return scan.found.filter((f) => looksLikeCypher(f.text));
}

/**
 * Scan code from `i`, collecting string literals. With `stopAtBrace`, returns at the `}` that closes
 * a template interpolation.
 */
function scanCode(scan: SourceScan, i: number, stopAtBrace: boolean): number {
  const { source, end } = scan;
  let braces = 0;
  let lastSignificant = '';
  while (i < end) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '/') {
      while (i < end && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      i = close < 0 ? end : close + 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const start = i;
      i++;
      while (i < end && source[i] !== ch && source[i] !== '\n') {
        if (source[i] === '\\') i++;
        i++;
      }
      scan.found.push({ text: unescapeWhitespace(source.slice(start + 1, i)), line: scan.lineAt(start) });
      i++;
      lastSignificant = ch;
      continue;
    }
    if (ch === '`') {
      i = scanTemplate(scan, i);
      lastSignificant = '`';
      continue;
    }
    if (ch === '/' && (lastSignificant === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(lastSignificant)
      || /\b(return|typeof|case|of|in)$/.test(source.slice(Math.max(0, i - 7), i).trimEnd()))) {
      i = skipRegex(source, i, end);
      lastSignificant = '/';
      continue;
    }
    if (ch === '{') braces++;
    if (ch === '}') {
      if (stopAtBrace && braces === 0) return i + 1;
      braces--;
    }
    if (!/\s/.test(ch)) lastSignificant = ch;
    i++;
  }
  return i;
}

function skipRegex(source: string, i: number, end: number): number {
  i++;
  let inClass = false;
  while (i < end && source[i] !== '\n') {
    const ch = source[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) { i++; break; }
    i++;
  }
  while (i < end && /[a-z]/i.test(source[i])) i++;
  return i;
}

function scanTemplate(scan: SourceScan, i: number): number {
  const { source, end } = scan;
  const start = i;
  let text = '';
  i++;
  while (i < end && source[i] !== '`') {
    if (source[i] === '\\') {
      text += unescapeWhitespace(source.slice(i, i + 2));
      i += 2;
      continue;
    }
    if (source[i] === '$' && source[i + 1] === '{') {
      i = scanCode(scan, i + 2, true);
      text += INTERPOLATION_PLACEHOLDER;
      continue;
    }
    text += source[i];
    i++;
  }
  scan.found.push({ text, line: scan.lineAt(start) });
  return i + 1;
}

/** The `@cypher(statement: …)` statements of a GraphQL schema. */
export function cypherStatementsInSchema(sdl: string): CypherSource[] {
  const lineAt = lineIndex(sdl);
  const found: CypherSource[] = [];
  const pattern = /statement:\s*(?:"""([\s\S]*?)"""|"((?:[^"\\\n]|\\.)*)")/g;
  for (const m of sdl.matchAll(pattern)) {
    const block = m[1] !== undefined;
    const text = block ? m[1] : m[2];
    const offset = (m.index ?? 0) + m[0].indexOf(block ? '"""' : '"') + (block ? 3 : 1);
    found.push({ text, line: lineAt(offset) });
  }
  return found;
}

/**
 * The `.ts`, `.js`, `.mjs` and `.graphql` files under `root`, skipping `node_modules` and `dist`.
 * Sorted, so a lint's report reads the same on every run.
 */
export function cypherLintFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|js|mjs|graphql)$/.test(entry.name)) files.push(full);
    }
  };
  walk(root);
  return files.sort();
}

/**
 * The aggregation-key violations in each file: the `@cypher` statements of a `.graphql` schema, or
 * the Cypher strings of a source file. Lines are the file's.
 */
export function aggregationKeyViolationsInFiles(files: string[]): FileAggregationKeyViolation[] {
  const found: FileAggregationKeyViolation[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const strings = file.endsWith('.graphql') ? cypherStatementsInSchema(text) : cypherStringsInSource(text);
    for (const s of strings) {
      for (const v of aggregationKeyViolations(s.text)) found.push({ ...v, file, line: s.line + v.line - 1 });
    }
  }
  return found;
}

/** One line per violation, the file relative to `root`, for a lint's failure message. */
export function formatAggregationKeyViolation(v: FileAggregationKeyViolation, root: string): string {
  return `${path.relative(root, v.file)}:${v.line} ${v.keyword} reads ${v.variable} in "${v.column}"`;
}
