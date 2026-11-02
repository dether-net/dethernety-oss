#!/usr/bin/env bash
# Pins what the platform image's own Node does with the proxy variables the bundle gives it (HTTPS_PROXY, NO_PROXY, an
# empty HTTP_PROXY) when Node's built-in proxy support is switched on with NODE_USE_ENV_PROXY=1, with no internet: in a
# container with no network, a stand-in proxy on loopback records every CONNECT it is sent and refuses it. Then:
#
#   - fetch and https.get to an HTTPS name reach the proxy as CONNECT host:443;
#   - so does the signing-key fetch of the GraphQL layer's @authentication: jose's createRemoteJWKSet, as
#     @neo4j/graphql resolves it, which runs on the core https agent rather than fetch;
#   - a NO_PROXY name reaches the proxy from neither fetch nor https.get;
#   - a subdomain of a NO_PROXY name goes direct from fetch but through the proxy from https.get: the core agent
#     matches exact names only, which is why byodt takes exact names and .env.example says to list every host;
#   - an http:// request never reaches it, because the bundle sets no HTTP_PROXY.
#
# A Node or dependency release that changes this behaviour fails here instead of on an operator's host.
#
#   bash deploy/tests/image-env-proxy.sh ghcr.io/dether-net/dethernety:<version>   (pull it first: the run never pulls)
set -euo pipefail

IMAGE="${1:?usage: $0 <platform image>}"
ENGINE="${CONTAINER_ENGINE:-docker}"
PORT=18080

# The script runs as the container's only process. The proxy listens before any request is made; the requests are
# expected to fail (there is no network), and only what reached the proxy is checked.
read -r -d '' SCRIPT <<'JS' || true
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const seen = [];
const proxy = net.createServer((sock) => {
  sock.once('data', (buf) => {
    seen.push(buf.toString('latin1').split('\r\n')[0]);
    sock.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  });
  sock.on('error', () => {});
});
const settle = (p) => p.then(() => {}, () => {});
const viaFetch = (url) => settle(fetch(url, { signal: AbortSignal.timeout(3000) }));
const viaGet = (mod, url) => new Promise((resolve) => {
  const req = mod.get(url, (res) => { res.resume(); res.on('end', resolve); });
  req.on('error', resolve);
  req.setTimeout(3000, () => req.destroy());
});
// jose from @neo4j/graphql's own directory, the way the GraphQL layer loads it.
const joseOfGraphql = () => {
  let dir = path.dirname(require.resolve('@neo4j/graphql'));
  while (dir !== path.dirname(dir)) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg) && JSON.parse(fs.readFileSync(pkg, 'utf8')).name === '@neo4j/graphql') return createRequire(pkg)('jose');
    dir = path.dirname(dir);
  }
  throw new Error('@neo4j/graphql has no package.json above its entry point');
};
let jose;
try { jose = joseOfGraphql(); } catch (e) {
  process.stderr.write(`could not load jose from @neo4j/graphql: ${e.message}\n`);
  process.exit(2);
}
proxy.listen(Number(process.env.STAND_IN_PORT), '127.0.0.1', async () => {
  await viaFetch('https://via-fetch.invalid/');
  await viaGet(https, 'https://via-https.invalid/');
  await settle(jose.createRemoteJWKSet(new URL('https://via-jose.invalid/jwks'), { timeoutDuration: 3000 })({ alg: 'RS256' }, {}));
  await viaFetch('https://direct.invalid/');
  await viaGet(https, 'https://direct.invalid/');
  await viaFetch('https://sub-fetch.direct.invalid/');
  await viaGet(https, 'https://sub-get.direct.invalid/');
  await viaFetch('http://plain-fetch.invalid/');
  await viaGet(http, 'http://plain-get.invalid/');
  proxy.close();
  process.stdout.write(JSON.stringify(seen) + '\n');
});
JS

# Never pull (the image under test is the one just built), no healthcheck (the image's own would run curl beside the
# check), no capabilities (the check needs none).
out="$("$ENGINE" run --rm --pull never --no-healthcheck --network none --cap-drop ALL --entrypoint node \
  -e NODE_USE_ENV_PROXY=1 -e HTTPS_PROXY="http://127.0.0.1:$PORT" -e NO_PROXY=direct.invalid -e HTTP_PROXY= \
  -e STAND_IN_PORT="$PORT" "$IMAGE" -e "$SCRIPT")" || { echo "FAIL the image's node did not run the check"; exit 1; }
echo "the stand-in proxy saw: $out"

fail=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }
case "$out" in *'"CONNECT via-fetch.invalid:443 '*) ok "fetch to an HTTPS name goes through the proxy" ;; *) bad "fetch did not CONNECT through the proxy" ;; esac
case "$out" in *'"CONNECT via-https.invalid:443 '*) ok "https.get goes through the proxy" ;; *) bad "https.get did not CONNECT through the proxy" ;; esac
case "$out" in *'"CONNECT via-jose.invalid:443 '*) ok "the GraphQL layer's signing-key fetch (jose) goes through the proxy" ;; *) bad "jose's signing-key fetch did not CONNECT through the proxy" ;; esac
case "$out" in *'"CONNECT direct.invalid:'*) bad "a NO_PROXY name reached the proxy" ;; *) ok "a NO_PROXY name does not reach the proxy" ;; esac
case "$out" in *sub-fetch.direct.invalid*) bad "fetch sent a subdomain of a NO_PROXY name to the proxy" ;; *) ok "fetch reaches a subdomain of a NO_PROXY name directly" ;; esac
case "$out" in *'"CONNECT sub-get.direct.invalid:443 '*) ok "https.get sends a subdomain of a NO_PROXY name to the proxy (exact names only)" ;; *) bad "https.get no longer proxies a subdomain of a NO_PROXY name: revisit the exact-names rule and .env.example" ;; esac
case "$out" in *plain-*) bad "an http:// request reached the proxy" ;; *) ok "an http:// request never reaches the proxy" ;; esac
exit "$fail"
