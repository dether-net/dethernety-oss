#!/usr/bin/env node
// content-stub.mjs — a recording stand-in for the module content service.
//
// It exists so an end-to-end test can watch what the two senders ACTUALLY put on the wire. Both the
// operator console (Go) and the platform's module client (TypeScript) speak the v1 protocol to this
// service, and the property under test — that a request names the deployment's team if and only if it
// carries a credential — is not observable from either side alone. One server, both clients, one log.
//
// Stdlib only, so it needs no install step. That is the same constraint the rest of scripts/ is written
// under, and here it also means the harness can run before anything is built.
//
// The log is the assertion surface AND the transcript a person reads, deliberately the same thing:
//
//     GET /v1/entitlements auth=yes team=9Xk2QpLm4RtZaB7cWvNfEg
//     GET /v1/catalog/packages auth=no team=-
//
// Bodies are the minimum each client will accept. This is not a conformance fixture and must not grow
// into one — the real conformance suite lives with the service.

import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};

const logPath = arg('--log', null);
const port = Number(arg('--port', '0'));
if (!logPath) {
  console.error('content-stub: --log <path> is required');
  process.exit(2);
}

const TEAM_HEADER = 'x-deployment-team';
const json = (res, body) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://stub').pathname;
  const auth = req.headers.authorization ? 'yes' : 'no';
  // ABSENT AND PRESENT-BUT-EMPTY ARE DIFFERENT, and `|| '-'` recorded them identically because '' is
  // falsy. That mattered here more than it looks: assert_iff scores the transcript on `team=-` meaning
  // "no header on the wire", so an empty header riding a CREDENTIAL-FREE request — which the console is
  // explicitly forbidden to send, because those surfaces are publicly cacheable — logged as `team=-` and
  // scored as a pass. The one defect this harness exists to catch was invisible to it.
  const rawTeam = req.headers[TEAM_HEADER];
  const team = rawTeam === undefined ? '-' : rawTeam === '' ? '(empty)' : rawTeam;
  appendFileSync(logPath, `${req.method} ${path} auth=${auth} team=${team}\n`);

  // The catalog tier — public, and the console reads both of these on every /api/packages.
  if (path === '/v1/catalog/packages') {
    return json(res, { packages: [{ key: 'demo', name: 'Demo package', latest: '1.0.0' }] });
  }
  if (/^\/v1\/catalog\/packages\/[^/]+\/versions\/[^/]+$/.test(path)) {
    return json(res, { version: '1.0.0', modules: [], artifacts: [] });
  }
  // The entitled read-back. protocol "1" matches the console's wireProtocolVersion; a body without the
  // marker reads as could-not-ask, which would make this link prove nothing.
  if (path === '/v1/entitlements') {
    return json(res, { protocol: '1', packages: [{ key: 'demo' }] });
  }
  // The module client's own surfaces: a service descriptor, a module document, and one entitled fetch.
  if (path === '/meta') {
    return json(res, {
      service: 'content-stub',
      protocolVersions: ['1'],
      surfaces: ['catalog', 'content', 'eval'],
    });
  }
  if (/^\/v1\/catalog\/modules\/[^/]+\/versions\/[^/]+$/.test(path)) {
    // One class, not zero: the client treats a document with no classes as a corrupt response and
    // refuses it, which would leave the probe's catalog read erroring for a reason unrelated to
    // anything under test.
    return json(res, {
      protocol: '1',
      module: {
        name: 'demo-module',
        version: '1.0.0',
        componentClasses: [{ id: 'demo-class', name: 'Demo class' }],
      },
    });
  }
  if (/^\/v1\/content\/classes\/[^/]+\/versions\/[^/]+\/template$/.test(path)) {
    return json(res, { classId: 'demo-class', template: {} });
  }
  // Anything else still gets recorded — the biconditional is asserted over EVERY request, so a surface
  // nobody anticipated must not fall out of the log.
  return json(res, {});
});

server.listen(port, '127.0.0.1', () => {
  // The harness reads this line to learn the port. Listening on 0 and reporting back beats a fixed port
  // that collides with whatever else the machine is running.
  console.log(`PORT=${server.address().port}`);
});
