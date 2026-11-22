/**
 * The edge-kind table checked against the repository: every technique exists in the pinned MITRE pack; every
 * anchor, breaker and control names classes the open-source catalogue has, and attributes they hold as
 * booleans; every anchor has a class that emits one of its row's techniques; and every emitter locator points at
 * a finding that selects its row.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import shipped from '../src/edge-kinds.json';
import { ElementKind, EdgeKindRow, EdgeKindTable, ReadFrom, selectRows, validateTable } from '../src/table';

const OSS = path.resolve(__dirname, '..', '..', '..');
const CATALOGUE_ROOT = path.join(OSS, 'modules', 'dethernety-general', 'data');
const CATALOGUE = path.join(CATALOGUE_ROOT, 'dethernety-general');
const ATTACK_NODES = path.join(OSS, 'modules', 'mitre-frameworks', 'data', '01-attack-nodes.cypher');

const table = validateTable(shipped);

type Kind = ElementKind | 'control';
const KINDS: Kind[] = ['component', 'securityBoundary', 'dataFlow', 'data', 'control'];

interface CatalogueClass {
  kind: Kind;
  folder: string;
  name: string;
  booleans: Set<string>;
}

/** Every class of the open-source catalogue, by kind, with its name and boolean attributes. */
function catalogue(): CatalogueClass[] {
  const out: CatalogueClass[] = [];
  for (const kind of KINDS) {
    for (const d of readdirSync(path.join(CATALOGUE, kind), { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const dir = path.join(CATALOGUE, kind, d.name);
      const name = JSON.parse(readFileSync(path.join(dir, 'class.json'), 'utf8')).name as string;
      const props = JSON.parse(readFileSync(path.join(dir, 'schema.json'), 'utf8')).schema?.properties ?? {};
      const booleans = new Set(Object.entries(props).filter(([, p]) => (p as { type?: string }).type === 'boolean').map(([k]) => k));
      out.push({ kind, folder: d.name, name, booleans });
    }
  }
  return out;
}

/** The ATT&CK technique ids the pinned pack carries, read the way the pack's own reference check reads them. */
function attackIds(): Set<string> {
  const ids = new Set<string>();
  for (const m of readFileSync(ATTACK_NODES, 'utf8').matchAll(/^MERGE \(n:MitreAttackTechnique \{attack_id: "([^"]+)"\}\)/gm)) ids.add(m[1]);
  return ids;
}

/** An ATT&CK technique reference in a policy's `exploited_by`. */
const TECHNIQUE_REF = /"label":\s*"MitreAttackTechnique",\s*"property":\s*"attack_id",\s*"value":\s*"(T\d{4}(?:\.\d{3})?)"/g;

/** Each finding definition of a policy (with the rules after it), its first and last line and the techniques it is exploited by. */
function definitions(file: string): Array<{ start: number; end: number; techniques: string[]; text: string; name: string | null }> {
  const lines = readFileSync(file, 'utf8').split('\n');
  const starts = lines.flatMap((l, i) => (/^_\w+_def\s*:=\s*\{/.test(l) ? [i + 1] : []));
  return starts.map((start, j) => {
    const end = j + 1 < starts.length ? starts[j + 1] - 1 : lines.length;
    const text = lines.slice(start - 1, end).join('\n');
    return { start, end, techniques: [...text.matchAll(TECHNIQUE_REF)].map((m) => m[1]), text, name: /"name":\s*"([^"]+)"/.exec(text)?.[1] ?? null };
  });
}

/** The element kinds a breaker's read can land on. */
function kindsOfRead(read: ReadFrom, row: EdgeKindRow): Kind[] {
  switch (read) {
    case 'reached_end':
    case 'foothold':
    case 'flow_responder':
      return ['component'];
    case 'flow':
      return ['dataFlow'];
    case 'credential_item':
      return ['data'];
    case 'anchor':
      return [...new Set(row.anchors.map((a) => a.kind))];
    default:
      return ['securityBoundary'];
  }
}

describe('the edge-kind table against the repository', () => {
  const ids = attackIds();
  const classes = catalogue();
  const byName = (kind: Kind, name: string) => classes.find((c) => c.kind === kind && c.name === name);

  it('reads a real MITRE pack and catalogue (not an empty checkout)', () => {
    expect(ids.size).toBeGreaterThan(500);
    expect(classes.length).toBeGreaterThan(60);
  });

  it('is settled', () => {
    expect(table.status).toBe('settled');
  });

  it('names only techniques the pinned MITRE pack carries', () => {
    const missing = table.rows.flatMap((r) =>
      [...r.techniques, r.path.default, ...r.path.from_cited, ...r.attribute_breakers.flatMap((b) => b.techniques)].filter((t) => !ids.has(t)).map((t) => `${r.id}: ${t}`),
    );
    expect(missing).toEqual([]);
  });

  it('anchors on classes the catalogue has', () => {
    const missing = table.rows.flatMap((r) => r.anchors.flatMap((a) => a.classes.filter((c) => !byName(a.kind, c)).map((c) => `${r.id}: ${a.kind} ${c}`)));
    expect(missing).toEqual([]);
  });

  it('reads each breaker attribute where a class of that kind holds it as a boolean', () => {
    const problems: string[] = [];
    for (const r of table.rows) {
      for (const b of r.attribute_breakers) {
        const kinds = kindsOfRead(b.read_from, r);
        if (b.classes.length > 0) {
          for (const name of b.classes) {
            const cls = kinds.map((k) => byName(k, name)).find(Boolean);
            if (!cls) problems.push(`${r.id}: ${b.read_from} names ${name}, no ${kinds.join('/')} class`);
            else for (const attr of b.attributes) if (!cls.booleans.has(attr)) problems.push(`${r.id}: ${name} has no boolean ${attr}`);
          }
        } else if (!classes.some((c) => kinds.includes(c.kind) && b.attributes.every((a) => c.booleans.has(a)))) {
          problems.push(`${r.id}: no ${kinds.join('/')} class holds ${b.attributes.join(' + ')} as booleans`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('names control classes the catalogue has, with the attributes it reads on them', () => {
    const problems = table.rows.flatMap((r) =>
      r.control_breakers.flatMap((b) =>
        b.control_classes.flatMap((name) => {
          const cls = byName('control', name);
          if (!cls) return [`${r.id}: no control class ${name}`];
          return b.attributes_true.filter((a) => !cls.booleans.has(a)).map((a) => `${r.id}: ${name} has no boolean ${a}`);
        }),
      ),
    );
    expect(problems).toEqual([]);
  });

  it('has, for every anchor, a class that emits a technique selecting the row', () => {
    const unanchored: string[] = [];
    for (const r of table.rows) {
      for (const a of r.anchors) {
        const candidates = classes.filter((c) => c.kind === a.kind && (a.classes.length === 0 || a.classes.includes(c.name)));
        const found = candidates.some((c) => {
          const file = path.join(CATALOGUE, c.kind, c.folder, 'policies.rego');
          if (!existsSync(file)) return false;
          return definitions(file).some((d) => selectRows(table, d.techniques, a.kind, c.name).some((sel) => sel.row.id === r.id));
        });
        if (!found) unanchored.push(`${r.id}: ${a.kind} ${a.classes.join(', ') || '(any class)'}`);
      }
    }
    expect(unanchored).toEqual([]);
  });

  /** What is wrong with a table's emitter locators. */
  function locatorProblems(t: EdgeKindTable): string[] {
    const problems: string[] = [];
    for (const r of t.rows) {
      for (const locator of r.emitters) {
        const [file, line] = locator.split(':');
        const [, kind, folder] = file.split('/') as [string, ElementKind, string];
        const cls = classes.find((c) => c.kind === kind && c.folder === folder);
        if (!cls) {
          problems.push(`${r.id}: ${locator} names no class`);
          continue;
        }
        const anchors = r.anchors.filter((a) => a.kind === kind && (a.classes.length === 0 || a.classes.includes(cls.name)));
        if (anchors.length === 0) {
          problems.push(`${r.id}: ${locator} is a ${kind} class this row does not anchor on`);
          continue;
        }
        const defs = definitions(path.join(CATALOGUE_ROOT, file));
        const at = line ? defs.filter((d) => Number(line) >= d.start && Number(line) <= d.end) : defs;
        if (!at.some((d) => selectRows(t, d.techniques, kind, cls.name).some((sel) => sel.row.id === r.id))) {
          problems.push(`${r.id}: ${locator} defines no finding whose technique selects this row`);
        }
      }
    }
    return problems;
  }

  /** Every finding of the catalogue, with the rows its techniques select (as one exposure). */
  const findings = classes
    .filter((c) => c.kind !== 'control' && existsSync(path.join(CATALOGUE, c.kind, c.folder, 'policies.rego')))
    .flatMap((c) =>
      definitions(path.join(CATALOGUE, c.kind, c.folder, 'policies.rego')).map((d) => ({
        locator: `dethernety-general/${c.kind}/${c.folder}/policies.rego:${d.start}`,
        cls: c,
        def: d,
        rows: selectRows(table, d.techniques, c.kind as ElementKind, c.name).map((sel) => sel.row.id),
      })),
    );

  it('lists as own conditions exactly the findings that fire on the attribute, on an element the breaker reads it on', () => {
    const problems: string[] = [];
    for (const r of table.rows) {
      const anchorKinds = [...new Set(r.anchors.map((a) => a.kind))];
      for (const b of r.attribute_breakers) {
        const readKinds: Kind[] = b.read_from === 'anchor' ? anchorKinds : kindsOfRead(b.read_from, r);
        const expected = findings
          .filter((f) => f.rows.includes(r.id) && readKinds.includes(f.cls.kind) && b.classes.includes(f.cls.name))
          .filter((f) => b.attributes.some((a) => new RegExp(`not\\s+input\\.${a}\\b|input\\.${a}\\s*==\\s*false|input\\.${a}\\s*!=\\s*true`).test(f.def.text)))
          .map((f) => `${f.cls.name}: ${f.def.name}`)
          .sort();
        const listed = b.own_condition.map((o) => `${o.class}: ${o.exposure}`).sort();
        if (JSON.stringify([...new Set(expected)]) !== JSON.stringify(listed)) {
          problems.push(`${r.id} ${b.read_from} ${b.attributes.join('+')}: expected ${expected.join(', ') || 'none'}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('has no technique entry that no finding selects (a dead entry hides a typo)', () => {
    const live = new Set(findings.flatMap((f) => f.rows.flatMap((id) => f.def.techniques.map((t) => `${id}\u0000${t}`))));
    const reach = (id: string, t: string) => live.has(`${id}\u0000${t}`) || [...live].some((k) => k.startsWith(`${id}\u0000${t}.`));
    const dead = table.rows.flatMap((r) => r.techniques.filter((t) => !reach(r.id, t)).map((t) => `${r.id}: ${t}`));
    expect(dead).toEqual([]);
  });

  it('selects rows for the catalogue as recorded (any change shows here)', async () => {
    const matrix = findings.filter((f) => f.def.techniques.length > 0).map((f) => `${f.locator} ${f.def.techniques.join(',')} -> ${f.rows.join(',') || '-'}`);
    await expect(`${matrix.join('\n')}\n`).toMatchFileSnapshot('__snapshots__/selection-matrix.txt');
  });

  it('selects the intended row for findings whose choice is not obvious', () => {
    const at = (locator: string) => findings.find((f) => f.locator === `dethernety-general/${locator}`)?.rows;
    expect(at('securityBoundary/operating-system-host/policies.rego:159')).toEqual(['credential-reuse/cr-3']);
    expect(at('dataFlow/internal-service-communication/policies.rego:197')).toEqual(['credential-reuse/cr-3f']);
    expect(at('securityBoundary/operating-system-host/policies.rego:191')).toEqual(['remote-service/rs-2']);
    expect(at('component/relational-database/policies.rego:91')).toEqual(['credential-reuse/cr-1']);
    // T1078 here is the context of T1078.001 (default credentials), so only the default-account row is chosen.
    expect(at('component/relational-database/policies.rego:41')).toEqual(['credential-reuse/cr-2']);
    expect(at('dataFlow/message-publish-consume/policies.rego:191')).not.toContain('remote-service/rs-3f');
    expect(at('dataFlow/kerberos-authentication/policies.rego:111')).toEqual(['credential-reuse/cr-4c']);
  });

  it("checks the table's emitter locators, down to the finding at each line", () => {
    expect(locatorProblems(table)).toEqual([]);
  });

  it('refuses a locator of a kind the row does not anchor on, of an unknown class, and at a finding of another row', () => {
    const raw = JSON.parse(JSON.stringify(shipped));
    const escapeRaw = raw.rows.find((r: { id: string }) => r.id === 'host-escape/he-1');
    escapeRaw.emitters = [
      'dethernety-general/dataFlow/kerberos-authentication/policies.rego',
      'dethernety-general/securityBoundary/no-such-class/policies.rego',
      'dethernety-general/securityBoundary/container/policies.rego:1',
    ];
    const t = validateTable(raw);
    expect(locatorProblems(t)).toEqual([
      'host-escape/he-1: dethernety-general/dataFlow/kerberos-authentication/policies.rego is a dataFlow class this row does not anchor on',
      'host-escape/he-1: dethernety-general/securityBoundary/no-such-class/policies.rego names no class',
      'host-escape/he-1: dethernety-general/securityBoundary/container/policies.rego:1 defines no finding whose technique selects this row',
    ]);
  });
});
