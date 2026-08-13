#!/bin/sh
# Front-door TLS. The stock nginx image runs /docker-entrypoint.d/*.sh before starting nginx; this
# renders the active config from the mounted template (nginx.conf.in), turning the __TLS_*__ markers
# into an HTTPS listener when a certificate is present in the mounted tls/ dir, or a plain-HTTP
# listener otherwise. Only the edge (client → front door) is encrypted; the proxy → backend hops stay
# plain HTTP on the isolated stack network regardless.
set -eu

SRC=/etc/nginx/nginx.conf.in
DST=/etc/nginx/conf.d/default.conf
CERT=/etc/nginx/tls/cert.pem
KEY=/etc/nginx/tls/key.pem

# The container DNS server differs by engine — Docker publishes 127.0.0.11, Podman's
# aardvark-dns a per-network address — and nginx's `resolver` needs it as a literal.
# Read whatever this runtime actually handed the container so request-time upstream
# resolution works on both; fall back to Docker's well-known address if none is found.
RESOLVER=$(awk '/^nameserver/ { print $2; exit }' /etc/resolv.conf 2>/dev/null || true)
RESOLVER=${RESOLVER:-127.0.0.11}

if [ -f "$CERT" ] && [ -f "$KEY" ]; then
  sed \
    -e 's|.*__TLS_LISTEN__.*|    listen 80 ssl default_server;|' \
    -e 's|.*__TLS_CERT__.*|    ssl_certificate /etc/nginx/tls/cert.pem; ssl_certificate_key /etc/nginx/tls/key.pem; ssl_protocols TLSv1.2 TLSv1.3;|' \
    -e "s|__RESOLVER__|${RESOLVER}|" \
    "$SRC" > "$DST"
  echo "front door: HTTPS (certificate found in tls/); resolver ${RESOLVER}"
else
  sed \
    -e 's|.*__TLS_LISTEN__.*|    listen 80 default_server;|' \
    -e 's|.*__TLS_CERT__.*||' \
    -e "s|__RESOLVER__|${RESOLVER}|" \
    "$SRC" > "$DST"
  echo "front door: plain HTTP (no certificate in tls/); resolver ${RESOLVER}"
fi
