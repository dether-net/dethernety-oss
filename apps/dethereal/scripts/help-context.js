#!/usr/bin/env node
// Dethereal help context script — produces state-aware command suggestions
// Used by the /dethereal:help skill to show "Suggested now" section
// Standalone script — no dependencies beyond Node.js built-ins

const fs = require('fs');
const path = require('path');

const MODELS_FILE = '.dethernety/models.json';

function main() {
  // No models registry → suggest getting started
  if (!fs.existsSync(MODELS_FILE)) {
    output(null, [
      { command: 'create', reason: 'Create your first threat model' },
      { command: 'login', reason: 'Connect to the Dethernety platform' },
    ]);
    return;
  }

  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(MODELS_FILE, 'utf8'));
  } catch {
    output(null, [
      { command: 'create', reason: 'Create your first threat model' },
    ]);
    return;
  }

  const models = registry.models || [];
  if (models.length === 0) {
    output(null, [
      { command: 'create', reason: 'Create your first threat model' },
      { command: 'discover', reason: 'Auto-discover infrastructure from your codebase' },
    ]);
    return;
  }

  // Use the first model for context
  const model = models[0];
  const modelName = model.name || 'Unnamed';
  const modelPath = model.path;

  // Read state
  let state = 'INITIALIZED';
  try {
    const stateData = JSON.parse(
      fs.readFileSync(path.join(modelPath, '.dethereal', 'state.json'), 'utf8')
    );
    state = stateData.currentState || 'INITIALIZED';
  } catch {}

  // Read quality
  let score = null;
  try {
    const qualityData = JSON.parse(
      fs.readFileSync(path.join(modelPath, '.dethereal', 'quality.json'), 'utf8')
    );
    score = Math.round(qualityData.quality_score);
  } catch {}

  const contextLine = score !== null
    ? `model "${modelName}" at ${score}/100 quality`
    : `model "${modelName}"`;

  // State-based suggestions
  const suggestions = getSuggestions(state, score);

  // Check platform connectivity
  if (!process.env.DETHERNETY_URL) {
    // Remove sync suggestions if no platform configured
    const filtered = suggestions.filter(s => s.command !== 'sync');
    if (!filtered.some(s => s.command === 'login')) {
      filtered.push({ command: 'login', reason: 'Connect to the Dethernety platform' });
    }
    output(contextLine, filtered);
    return;
  }

  output(contextLine, suggestions);
}

function getSuggestions(state, score) {
  switch (state) {
    case 'INITIALIZED':
      return [
        { command: 'create', reason: 'Describe your system to build the model' },
        { command: 'discover', reason: 'Auto-discover infrastructure from codebase' },
      ];

    case 'SCOPE_DEFINED':
      return [
        { command: 'discover', reason: 'Scan codebase for infrastructure components' },
        { command: 'add', reason: 'Manually add components and boundaries' },
      ];

    case 'DISCOVERED':
      return [
        { command: 'add', reason: 'Refine discovered components and boundaries' },
        { command: 'classify', reason: 'Assign classes to components' },
        { command: 'view', reason: 'Review the current model structure' },
      ];

    case 'STRUCTURE_COMPLETE':
      return [
        { command: 'classify', reason: 'Assign classes to unclassified elements' },
        { command: 'enrich', reason: 'Add security attributes' },
        { command: 'review', reason: 'Check model quality before enrichment' },
      ];

    case 'ENRICHING':
      return [
        { command: 'enrich', reason: 'Continue adding security attributes' },
        { command: 'review', reason: 'See full quality breakdown' },
        ...(score !== null && score >= 70
          ? [{ command: 'sync push', reason: 'Model ready for platform analysis' }]
          : []),
      ];

    case 'REVIEWED':
      return [
        { command: 'sync push', reason: 'Push model to platform for analysis' },
        { command: 'surface', reason: 'View attack surface summary' },
        { command: 'view', reason: 'Review final model' },
      ];

    default:
      return [
        { command: 'status', reason: 'Check current state' },
        { command: 'help', reason: 'See all available commands' },
      ];
  }
}

function output(contextLine, suggestions) {
  console.log(JSON.stringify({
    context_line: contextLine,
    suggestions: suggestions.slice(0, 3),
  }));
}

main();
