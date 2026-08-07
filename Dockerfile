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

# pg requires native deps on alpine - ensure they're available
RUN apk add --no-cache postgresql-client

WORKDIR /app
# /app 을 미리 node 소유로 만들고 이후 COPY/install 을 node 유저로 수행한다.
# 과거처럼 마지막에 `RUN chown -R node:node /app` 을 하면 chown 이 모든 파일의 메타데이터를
# 바꿔 유니온 FS 가 /app 전체를 새 레이어에 복사한다 → 이미지에 node_modules 가 두 벌
# 들어가 레이어 하나가 199MB 늘었다(실측). 소유권은 생성 시점에 정하는 게 맞다.
RUN chown node:node /app
USER node

# Copy only production artifacts
# --prod 는 devDependencies 를 건너뛴다. 클라이언트 라이브러리(react·radix·recharts·
# lucide-react·react-day-picker→date-fns 등)는 Vite 가 빌드 시 dist/public 으로 번들하므로
# 런타임에 필요 없다 → devDependencies 에 둬야 이 스테이지에 설치되지 않는다.
COPY --chown=node:node package.json pnpm-lock.yaml ./
COPY --chown=node:node patches/ ./patches/
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder --chown=node:node /app/dist ./dist

# Environment
ENV NODE_ENV=production
ENV PORT=3001

# Health check — 무인증 전용 /healthz(인증 경로 /api/connectors 는 prod 401 → 거짓 정상 판정).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/healthz || exit 1

EXPOSE 3001

CMD ["node", "dist/index.js"]
