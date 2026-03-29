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

# Read hook input from stdin (Claude Code passes JSON on stdin for command hooks)
INPUT_JSON=$(cat)

# Extract file path from the hook input.
# Pipe via stdin — the JSON can be very large (contains full file content for Write)
# and may contain shell-hostile characters, so passing as argv is unsafe.
FILE_PATH=$(printf '%s' "$INPUT_JSON" | node -e "
  const fs = require('fs');
  try {
    const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
    const toolInput = input.tool_input || input.toolInput || input || {};
    console.log(toolInput.file_path || toolInput.filePath || toolInput.path || '');
  } catch { console.log(''); }
" 2>/dev/null || echo "")

# No file path available → exit silently
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Check if the written file is under any registered model directory
IS_MODEL_FILE=$(node -e "
  const fs = require('fs');
  const path = require('path');
  try {
    const registry = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    const filePath = path.resolve(process.argv[2]);
    const isModel = (registry.models || []).some(m => {
      const modelDir = path.resolve(m.path);
      return filePath.startsWith(modelDir + path.sep) || filePath === modelDir;
    });
    console.log(isModel ? 'yes' : 'no');
  } catch { console.log('no'); }
" "$MODELS_FILE" "$FILE_PATH" 2>/dev/null || echo "no")

if [ "$IS_MODEL_FILE" = "yes" ]; then
  echo "[dethereal] Model file changed. Consider running validation: mcp__dethereal__validate_model_json"
fi
