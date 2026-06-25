# KMX EDC UI — Multi-stage Docker build
# Stage 1: Build frontend + BFF server
# Stage 2: Production image (Node.js slim)

# ── Build Stage ──────────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

WORKDIR /app

# Install dependencies first (Docker layer cache)
# --frozen-lockfile: lockfile 무결성 강제(공급망 변조/의도치 않은 버전 유입 차단).
COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/
RUN pnpm install --frozen-lockfile

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
RUN pnpm install --frozen-lockfile --prod

# pg requires native deps on alpine - ensure they're available
RUN apk add --no-cache postgresql-client

COPY --from=builder /app/dist ./dist

# 비root 실행 — 컨테이너 침해 시 권한 최소화(node 이미지 기본 비root 유저 uid 1000).
RUN chown -R node:node /app
USER node

# Environment
ENV NODE_ENV=production
ENV PORT=3001

# Health check — 무인증 전용 /healthz(인증 경로 /api/connectors 는 prod 401 → 거짓 정상 판정).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/healthz || exit 1

EXPOSE 3001

CMD ["node", "dist/index.js"]
