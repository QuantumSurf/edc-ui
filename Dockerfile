# KMX EDC UI — Multi-stage Docker build
# Stage 1: Build frontend + BFF server
# Stage 2: Production image (Node.js slim)

# ── Build Stage ──────────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

WORKDIR /app

# Install dependencies first (Docker layer cache)
COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/
RUN pnpm install --no-frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm build

# ── Production Stage ─────────────────────────────────────────────
FROM node:22-alpine AS production

RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

WORKDIR /app

# Copy only production artifacts
COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/
RUN pnpm install --no-frozen-lockfile --prod

# pg requires native deps on alpine - ensure they're available
RUN apk add --no-cache postgresql-client

COPY --from=builder /app/dist ./dist

# Environment
ENV NODE_ENV=production
ENV PORT=3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/connectors || exit 1

EXPOSE 3001

CMD ["node", "dist/index.js"]
