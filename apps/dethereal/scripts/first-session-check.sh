#!/usr/bin/env bash
# Dethereal SessionStart hook — first-session orientation or resume hint
set -euo pipefail

MODELS_FILE=".dethernety/models.json"

# Check if models registry exists and has models
if [ -f "$MODELS_FILE" ]; then
  MODEL_COUNT=$(node -e "
    try {
      const m = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
      console.log((m.models || []).length);
    } catch { console.log(0); }
  " "$MODELS_FILE" 2>/dev/null || echo 0)
else
  MODEL_COUNT=0
fi

# Detect platform connectivity
PLATFORM_LINE=""
if [ -z "${DETHERNETY_URL:-}" ]; then
  if ! curl -s --max-time 1 http://localhost:3003/config >/dev/null 2>&1; then
    PLATFORM_LINE="  Platform: not connected (run /dethereal:login to connect)"
  fi
fi

if [ "$MODEL_COUNT" -eq 0 ]; then
  # First session — no models exist
  cat <<ORIENTATION
Dethereal threat modeling plugin is active.

  /dethereal:create   -- Create or import your first threat model
  /dethereal:status   -- Check connection and auth status
  /dethereal:help     -- See all available commands

  Or just describe your system in natural language:
  "I have a React frontend talking to a Go API with a PostgreSQL database"
ORIENTATION
  if [ -n "$PLATFORM_LINE" ]; then
    echo ""
    echo "$PLATFORM_LINE"
  fi
else
  # Returning session — show resume hint
  node -e "
    const fs = require('fs');
    try {
      const registry = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
      const models = registry.models || [];
      const count = models.length;

      if (count > 1) {
        console.log('Dethereal active. ' + count + ' local models. Run /dethereal:status for details.');
      } else {
        const model = models[0];
        const name = model.name || 'Unnamed';
        const modelPath = model.path;

        let state = 'INITIALIZED';
        let score = '?';

        try {
          const s = JSON.parse(fs.readFileSync(modelPath + '/.dethereal/state.json', 'utf8'));
          state = s.currentState || 'INITIALIZED';
        } catch {}

        try {
          const q = JSON.parse(fs.readFileSync(modelPath + '/.dethereal/quality.json', 'utf8'));
          score = Math.round(q.quality_score);
        } catch {}

        console.log('Dethereal active.');
        console.log('');
        console.log('  \"' + name + '\"  ' + score + '/100 quality (' + state + ')');
        console.log('');
        console.log('  /dethereal:enrich         -- Continue enrichment');
        console.log('  /dethereal:threat-model   -- Resume guided workflow');
      }
    } catch (e) {
      console.log('Dethereal active. Run /dethereal:status to check model state.');
    }
  " "$MODELS_FILE" 2>/dev/null

  if [ -n "$PLATFORM_LINE" ]; then
    echo ""
    echo "$PLATFORM_LINE"
  fi
fi
