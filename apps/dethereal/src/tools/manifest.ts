/**
 * The frozen contract of every MCP tool: name, approval class, actions and
 * top-level inputs. Prompt linting and the per-harness writers read tool names
 * and approval classes from here, and a test holds the registered tools to it.
 *
 * `status: 'conformant'` — the implementation matches this entry exactly.
 * `status: 'planned'` — this entry is the target; the implementation does not
 * exist yet or still differs (`retiring` lists inputs it may still accept).
 *
 * Input kinds for planned inputs:
 * - `model_dir`: a model directory, confined to the project before use;
 * - `enum:a|b|c`: one of the listed values;
 * - `commit`: a git commit id, `^[0-9a-f]{7,64}$`;
 * - `element_ids`: validated element ids, at most 500;
 * - `element_id_set`: validated element ids compared as an exact set, at most 5000;
 * - `text`: bounded free text (≤ 500 characters, no control characters) — it is
 *   stored in committed files and read back in later sessions;
 * - `platform_fields`: a strict object of platform-sourced fields;
 * - `integer`, `boolean`;
 * - `array`: a bounded list of structured entries (≤ 50)
 * - `any`: an existing input, recorded by name only.
 *
 * `approval`: `auto` tools run without a prompt in harnesses that ask per tool;
 * `prompt` tools always ask. A writer that finds no entry treats the tool as `prompt`.
 *
 * `requiresUser`: the tool is listed as needing the operator's interaction, so a
 * harness that honours that hint never runs it unattended.
 *
 * `settlementOnly`: inputs the server lists only with the settlement on (`DETHEREAL_SETTLEMENT`).
 */

export type InputKind =
  | 'any'
  | 'model_dir'
  | 'commit'
  | 'element_ids'
  | 'element_id_set'
  | 'text'
  | 'platform_fields'
  | 'integer'
  | 'boolean'
  | 'array'
  | `enum:${string}`

export interface ManifestTool {
  readonly name: string
  readonly approval: 'auto' | 'prompt'
  readonly status: 'conformant' | 'planned'
  readonly actions?: readonly string[]
  readonly inputs: Readonly<Record<string, InputKind>>
  readonly retiring?: readonly string[]
  readonly requiresUser?: true
  readonly settlementOnly?: readonly string[]
}

const names = (...keys: string[]): Record<string, InputKind> => Object.fromEntries(keys.map((k) => [k, 'any' as const]))

const MODEL_STATES = 'enum:INITIALIZED|SCOPE_DEFINED|DISCOVERED|STRUCTURE_COMPLETE|ENRICHING|REVIEWED' as const
const GATE3_CRITERIA = 'enum:C1|C2|C3|C4|C5|C6|C7|C8|C9' as const

export const TOOL_MANIFEST: readonly ManifestTool[] = Object.freeze<ManifestTool[]>([
  // Session
  { name: 'login', approval: 'prompt', status: 'conformant', inputs: { wait: 'integer', force_new: 'boolean' } },
  { name: 'auth_status', approval: 'auto', status: 'conformant', inputs: names('verify') },
  { name: 'logout', approval: 'prompt', status: 'conformant', inputs: names('clear_all') },

  // Workspace and state
  { name: 'workspace_status', approval: 'auto', status: 'conformant', inputs: names('directory_path') },
  { name: 'detect_drift', approval: 'auto', status: 'conformant', inputs: { directory_path: 'model_dir' } },
  {
    name: 'model_state',
    approval: 'auto',
    status: 'conformant',
    actions: ['get', 'transition', 'set_baseline', 'stale', 'merge_pulled', 'loop_back', 'mode'],
    inputs: {
      action: 'enum:get|transition|set_baseline|stale|merge_pulled|loop_back|mode',
      directory_path: 'model_dir',
      to: MODEL_STATES,
      commit: 'commit', // or 'HEAD', which the server reads (set_baseline and transition)
      add: 'element_ids',
      remove: 'element_ids',
      drop: 'array', // [{element_id, reason}], 1–50: loop-back elements left unfixed, each with why (1–500 characters)
      drop_remaining: 'any', // {reason}: every element still untouched, with one reason
      mode: 'enum:quick|full', // 'quick' marks a quick model (never REVIEWED); 'full' clears the mark and keeps quick_through
      quick_through: 'any', // 7 | 8 | null: the last quick step finished (it only rises); null clears it
      include: 'array', // get: 'pending_rows' | 'pending_sources' | 'unregistered_rows', the row lists given only on request
      pending_from: 'any', // get with pending_rows: the first row number of the page (1–5000)
      pending_limit: 'integer', // get with pending_rows: the most rows in the page (rows: up to 100, the default; table: up to 250)
      pending_render: 'enum:rows|table', // get with pending_rows: 'table' gives pending_table, printed to the operator as it is
    },
    settlementOnly: ['include', 'pending_from', 'pending_limit', 'pending_render'],
  },
  {
    name: 'model_state_waive',
    approval: 'prompt',
    status: 'conformant',
    requiresUser: true,
    inputs: {
      directory_path: 'model_dir',
      criterion: GATE3_CRITERIA,
      element_ids: 'element_ids',
      reason: 'text',
      basis: 'enum:not_applicable|not_observable|accepted_risk|platform_limitation',
      revoke: 'boolean',
    },
  },
  {
    name: 'model_state_settle', approval: 'prompt', status: 'conformant', requiresUser: true,
    actions: ['settle', 'prepare', 'commit'],
    inputs: {
      action: 'enum:settle|prepare|commit',
      directory_path: 'model_dir',
      items: 'array', // [{row?, group, element_id, element_name?, field, decision: accept|reject|modify|confirm|set, value?, record?, removed?, absent?}], up to 50, each naming its value; set names its element; settle and prepare
      confirm: 'any', // {"<group>/<element_id>/<field>": value}: registration-only confirms, each exactly a confirm item (values ≤256 bytes; a record field unless the attribute bag holds one of that name)
      accept: 'any',  // the same keys, for accepted pending rows; items, map entries and accepted rows ≤250 per call
      accept_rows: 'any', // settle and prepare: {from, to, digest, except}, one range of pending rows accepted as shown
      reply: 'text',  // settle and commit: the operator's quoted reply
      orphaned_acknowledged: 'integer', // get's orphaned_registrations.total, shown to the operator; required when non-zero
      plan_id: 'text', // commit: the plan prepare returned
      lines: 'array', // commit: the plan's lines exactly as prepare returned them (lines_differ otherwise)
    },
  },
  {
    name: 'model_state_prune', approval: 'prompt', status: 'conformant', requiresUser: true,
    inputs: {
      directory_path: 'model_dir',
      files: 'array', // the orphaned attribute files, exactly as the server finds them, 1–50
    },
  },

  // Validation and reference
  {
    name: 'validate_model_json',
    approval: 'auto',
    status: 'conformant',
    actions: ['validate', 'quality', 'coverage', 'zoning', 'gates'],
    inputs: {
      ...names('action', 'assets', 'directory_path', 'model_id', 'data', 'file_type'),
      detail: 'enum:summary|full',
      include: 'array', // validate with directory_path: 'gates' | 'zoning', each part as its own action returns it
    },
  },
  { name: 'get_model_schema', approval: 'auto', status: 'conformant', inputs: names('include_examples') },
  { name: 'get_example_models', approval: 'auto', status: 'conformant', inputs: names('type', 'file_type') },

  // Model files and platform sync
  { name: 'import_model', approval: 'prompt', status: 'conformant', requiresUser: true, inputs: names('directory_path', 'folder_id', 'create_backup', 'disable_source_file_update') },
  { name: 'export_model', approval: 'prompt', status: 'conformant', inputs: names('model_id', 'directory_path', 'if_exists') },
  {
    name: 'update_model',
    approval: 'prompt',
    status: 'conformant',
    requiresUser: true,
    inputs: {
      ...names('model_id', 'directory_path', 'delete_orphaned', 'create_backup', 'disable_source_file_update'),
      overwrite_changed: 'element_id_set',
      overwrite_revision: 'text',
    },
  },
  { name: 'create_threat_model', approval: 'prompt', status: 'conformant', requiresUser: true, inputs: names('model', 'folder_id', 'directory_path', 'include_schema', 'include_example', 'example_type') },
  { name: 'list_models', approval: 'auto', status: 'conformant', inputs: names('folder_id', 'name') },

  // Classes and attributes
  {
    name: 'get_classes', approval: 'auto', status: 'conformant',
    inputs: {
      ...names('class_id', 'name', 'class_type', 'category', 'module_id', 'module_name', 'fields', 'limit', 'offset', 'view'),
      enrich_offset: 'integer', // with class_id and fields enrich: the first template field of the enrich page (a class's enrich view pages under the size budget)
    },
  },
  { name: 'match_classes', approval: 'auto', status: 'conformant', inputs: names('elements', 'classLabel', 'componentType', 'moduleIds', 'topN', 'fields') },
  { name: 'update_attributes', approval: 'prompt', status: 'conformant', requiresUser: true, inputs: { ...names('model_id', 'directory_path'), overwrite_changed: 'element_id_set', overwrite_revision: 'text' } },
  { name: 'generate_attribute_stubs', approval: 'prompt', status: 'conformant', inputs: names('directory_path', 'element_ids') },

  // MITRE
  {
    name: 'search_mitre_attack',
    approval: 'auto',
    status: 'conformant',
    actions: ['search', 'tactics', 'techniques_by_tactic', 'technique', 'mitigations', 'mitigation'],
    inputs: names('action', 'query', 'tactic_id', 'attack_id'),
  },
  {
    name: 'get_mitre_defend',
    approval: 'auto',
    status: 'conformant',
    actions: ['tactics', 'techniques_by_tactic', 'technique'],
    inputs: names('action', 'tactic_id', 'd3fend_id'),
  },

  // Controls, countermeasures, analyses (reading controls, countermeasures and exposures is the query_* tools')
  {
    name: 'manage_controls',
    approval: 'prompt',
    status: 'conformant',
    actions: [
      'create', 'update', 'delete', 'assign', 'pull-controls', 'push-greenfield',
      'push-brownfield', 'tombstone', 'set-local-edited', 'promote-external-edit', 'inspect-wal', 'clear-wal',
    ],
    inputs: names(
      'action', 'folder_id', 'control_id', 'class_ids', 'name', 'description', 'class_type', 'element_ids',
      'module_id', 'module_name', 'directory_path', 'control_ids',
      'supporting_element_ids', 'live_assigned_model_ids', 'this_model_id', 'decision', 'fresh_platform_attrs',
      'class_idx', 'new_attributes', 'edited_by',
    ),
  },
  {
    name: 'manage_countermeasures',
    approval: 'prompt',
    status: 'conformant',
    actions: ['create', 'update', 'delete'],
    inputs: names(
      'action', 'control_id', 'countermeasure_id', 'name', 'type', 'category', 'description', 'score',
      'exposure_ids', 'defend_technique_ids', 'mitigations', 'references',
    ),
  },
  {
    name: 'manage_analyses',
    approval: 'prompt',
    status: 'conformant',
    actions: ['list_classes', 'list', 'create', 'run', 'status', 'results', 'delete'],
    inputs: names('action', 'element_id', 'analysis_id', 'analysis_class_id', 'name', 'description'),
  },
  { name: 'get_control_gaps', approval: 'auto', status: 'conformant', inputs: names('model_id', 'top_n', 'limit') },

  // Read-only security queries (no prompt; every write stays in manage_*)
  {
    name: 'query_controls',
    approval: 'auto',
    status: 'conformant',
    actions: ['list', 'get', 'rank'],
    inputs: names('action', 'folder_id', 'control_id', 'class_ids', 'name', 'class_type', 'element_ids', 'module_id', 'module_name', 'element_types', 'top_n', 'limit'),
  },
  { name: 'query_exposures', approval: 'auto', status: 'conformant', actions: ['list', 'get'], inputs: names('action', 'element_id', 'exposure_id', 'limit') },
  { name: 'query_countermeasures', approval: 'auto', status: 'conformant', actions: ['list', 'get'], inputs: names('action', 'control_id', 'countermeasure_id', 'limit') },
])

export function manifestTool(name: string): ManifestTool | undefined {
  return TOOL_MANIFEST.find((t) => t.name === name)
}

export function manifestToolNames(): string[] {
  return TOOL_MANIFEST.map((t) => t.name)
}
