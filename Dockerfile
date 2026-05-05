# ── @gravity/agent-sdk — Standalone Microservice ─────────────────────────────
# Multi-stage build: build → slim production image
#
# Build:  docker build -t gravity-agent-service .
# Run:    docker compose up -d
# Test:   curl http://localhost:3001/api/agents/catalogue

# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (cached layer)
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Copy source
COPY . .

# Build Next.js standalone output
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── Stage 2: Production runner ────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001

# Non-root user for security
RUN addgroup --system --gid 1001 gravity && \
    adduser  --system --uid 1001 agentd

# Copy standalone Next.js output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER agentd

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/agents/catalogue || exit 1

CMD ["node", "server.js"]
