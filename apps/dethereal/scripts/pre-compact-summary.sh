#!/usr/bin/env bash
# Dethereal PreCompact hook — preserve model context across context window compaction
set -euo pipefail

MODELS_FILE=".dethernety/models.json"

# No models registry → exit silently
if [ ! -f "$MODELS_FILE" ]; then
  exit 0
fi

# Build structured summary of all tracked models
node -e "
  const fs = require('fs');

  try {
    const registry = JSON.parse(fs.readFileSync('$MODELS_FILE', 'utf8'));
    const models = (registry.models || []).map(m => {
      const result = {
        name: m.name || 'Unnamed',
        path: m.path
      };

      // Read state
      try {
        const state = JSON.parse(fs.readFileSync(m.path + '/.dethereal/state.json', 'utf8'));
        result.state = state.currentState || 'INITIALIZED';
        result.stale_elements = (state.staleElements || []).length;
      } catch {
        result.state = 'unknown';
      }

      // Read quality
      try {
        const quality = JSON.parse(fs.readFileSync(m.path + '/.dethereal/quality.json', 'utf8'));
        result.quality_score = Math.round(quality.quality_score);
        result.quality_label = quality.label;
      } catch {
        result.quality_score = null;
      }

      // Read manifest for element counts
      try {
        const manifest = JSON.parse(fs.readFileSync(m.path + '/manifest.json', 'utf8'));
        result.model_name = manifest.model?.name || m.name;
      } catch {}

      return result;
    });

    const summary = {
      dethereal_context: {
        models: models,
        timestamp: new Date().toISOString()
      }
    };

    console.log(JSON.stringify(summary, null, 2));
  } catch (e) {
    // Silent failure — don't block compaction
    process.exit(0);
  }
" 2>/dev/null
