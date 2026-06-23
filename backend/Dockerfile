# syntax=docker/dockerfile:1.6
#
# Fleet360 Go backend — multi-stage production image.
#
# Stage 1 (build): pinned Go on Alpine, fully reproducible from go.mod / go.sum.
# Stage 2 (runtime): distroless/static — no shell, no package manager, ~2 MB
# base. The final image carries only the statically-linked backend binary, a
# CA bundle (inherited from distroless/static), and the uploads/ directory the
# server writes into.
#
# Entrypoint pins `serve` so a container started with no args boots the HTTP
# server. `seed` and `cleanup` remain reachable for one-shot operator pods:
#   docker run --rm -e GO_ENV=development fleet360-backend seed
#   docker run --rm fleet360-backend cleanup
# Production must never override CMD to `seed` — the runSeed guard refuses to
# run with GO_ENV=production.

FROM golang:1.21-alpine AS build
WORKDIR /src

# Dependency layer first — go.mod/go.sum only — so a code-only change doesn't
# bust the module cache.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# CGO_ENABLED=0 → static binary that runs on distroless/static (no libc).
# -trimpath → no absolute build paths in the binary (smaller, reproducible).
# -ldflags="-s -w" → strip debug + symbol tables (~25% smaller binary).
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags="-s -w" \
    -o /out/backend .

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app

COPY --from=build /out/backend /app/backend
# Pre-create the uploads directory under the nonroot user so the server can
# write to it without needing a writable rootfs anywhere else.
COPY --from=build --chown=nonroot:nonroot /src/uploads /app/uploads

# Production default. Operators can override via the runtime env at deploy
# time, but the default is the safe one — runSeed refuses to seed when this
# is "production".
ENV GO_ENV=production

EXPOSE 8080
USER nonroot:nonroot

# ENTRYPOINT fixes the binary; CMD provides the default subcommand. Override
# CMD (not ENTRYPOINT) to run `seed` or `cleanup` from the same image.
ENTRYPOINT ["/app/backend"]
CMD ["serve"]
