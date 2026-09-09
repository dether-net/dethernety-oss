#!/usr/bin/env node
// dt-module-probe.cjs — drives the platform's module client the way the platform does.
//
// It configures NOTHING itself. Every value arrives in the environment — MODULE_CONTENT_BASE_URL and
// DEPLOYMENT_TEAM_ID — exactly as they reach the platform process, which is the whole point: the link
// under test is "a variable in the environment becomes a header on the wire", and passing the team in
// as an argument would step over it.
//
// It requires the BUILT output rather than the sources, for the same reason: dist/ is what ships inside
// the platform image. Run `pnpm --filter @dethernety/dt-module build` first.
//
// It makes no assertions. The stub's log is the evidence and the harness reads it; a probe that judged
// its own calls could pass while sending nothing.

const path = require('node:path');

const dist = path.join(__dirname, '..', '..', 'packages', 'dt-module', 'dist', 'index.js');
let DtRemoteModule;
try {
  ({ DtRemoteModule } = require(dist));
} catch (err) {
  console.error(`probe: cannot load ${dist} — run the dt-module build first\n${err.message}`);
  process.exit(2);
}

(async () => {
  // driver null: nothing here touches the graph. The mount stub passes the real one in production.
  const mod = new DtRemoteModule({ moduleKey: 'demo-module', pin: 'sha256:' + 'a'.repeat(64) }, null);

  // A public read (service descriptor + module document) and an entitled one. Failures are reported and
  // not swallowed, but they do not fail the probe: the request reaches the stub before any response is
  // parsed, so a body this stub renders imperfectly still proves what the harness is asking about.
  const step = async (name, fn) => {
    try {
      await fn();
      console.log(`probe: ${name} ok`);
    } catch (err) {
      console.log(`probe: ${name} completed with ${err.constructor.name} (the request still went out)`);
    }
  };

  await step('catalog read', () => mod.getMetadata());
  await step('entitled read', () => mod.getClassTemplate('demo-class', 'an-access-token'));
})();
