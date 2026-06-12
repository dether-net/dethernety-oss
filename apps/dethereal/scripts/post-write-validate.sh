#!/usr/bin/env bash
# Dethereal PostToolUse hook — validate after model file edits
# toolName: Write|Edit — fires on file write/edit in the session
# Must be fast on the non-model path (sub-100ms)
set -eo pipefail

MODELS_FILE=".dethernety/models.json"

# Fast path: no models registry → exit silently
if [ ! -f "$MODELS_FILE" ]; then
  exit 0
fi

# Extract the file path from the hook input AND check registry membership in
# ONE node invocation — this hook fires on every Write/Edit, and during heavy
# enrichment (one attribute file per element) each extra node spawn is pure
# per-write latency. The hook JSON streams via stdin — it can be very large
# (full file content for Write) and may contain shell-hostile characters, so
# only the registry path travels as argv.
IS_MODEL_FILE=$(node -e "
  const fs = require('fs');
  const path = require('path');
  try {
    const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
    const toolInput = input.tool_input || input.toolInput || input || {};
    const fileArg = toolInput.file_path || toolInput.filePath || toolInput.path || '';
    if (!fileArg) { console.log('no'); process.exit(0); }
    const registry = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    const filePath = path.resolve(fileArg);
    const isModel = (registry.models || []).some(m => {
      const modelDir = path.resolve(m.path);
      return filePath.startsWith(modelDir + path.sep) || filePath === modelDir;
    });
    console.log(isModel ? 'yes' : 'no');
  } catch { console.log('no'); }
" "$MODELS_FILE" 2>/dev/null || echo "no")

if [ "$IS_MODEL_FILE" = "yes" ]; then
  echo "[dethereal] Model file changed. Consider running validation: mcp__plugin_dethereal_dethereal__validate_model_json"
fi
