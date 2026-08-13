# The byodt-console image. Build context is the module root (oss/):
#
#   bash apps/byodt-console/build-assets.sh          # populate the gitignored embed tree first
#   docker build -f apps/byodt-console/Dockerfile --build-arg VERSION=<X.Y.Z> -t byodt-console .
#
# The embed tree (noauth schema + data corpus) is a build prerequisite, mirroring how the
# platform image copies pre-built artifacts rather than building them in-image.
# Pin the build stage to the native BUILD platform and cross-compile to the target: the whole
# binary is pure Go with CGO disabled, so cross-compiling on the runner's own arch is correct and
# turns an arm64 build from minutes of QEMU-emulating the Go toolchain into seconds.
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS build

RUN apk add --no-cache ca-certificates

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY pkg/ ./pkg/
COPY apps/byodt-console/ ./apps/byodt-console/

# TARGETOS/TARGETARCH are provided by buildx per requested platform; buildkit fills them from the
# host on a plain `docker build`, so a single-arch local build still works (empty GOARCH = native).
ARG TARGETOS TARGETARCH
ARG VERSION=dev
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} go build -trimpath \
    -ldflags "-s -w -X main.version=${VERSION}" \
    -o /out/byodt-console ./apps/byodt-console

FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /out/byodt-console /byodt-console
# Run as a non-root numeric uid:gid — this one-shot fetches over the network, extracts
# archives, and writes into a shared mount, so it should not run as root. scratch has no
# user database, so the id must be numeric. The bind-mounted modules directory, the schema
# path, and the state file must be writable by this uid at deploy time.
USER 65532:65532
ENTRYPOINT ["/byodt-console"]
CMD ["init"]
