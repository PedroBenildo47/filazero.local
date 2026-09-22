# syntax=docker/dockerfile:1
#
# FilaZero — production image (multi-stage).
#
#   deps     -> install dependencies once, with the Prisma schema present so the
#               client is generated at `npm ci` time
#   builder  -> `next build` (standalone output)
#   migrator -> keeps the Prisma CLI; used as a one-off service to run
#               `prisma migrate deploy` before the app starts
#   runner   -> minimal runtime, non-root user, healthcheck
#
# Build the app:     docker build --target runner   -t filazero:latest .
# Run migrations:    docker build --target migrator -t filazero:migrate .
#
# No secret is required at build time: environment validation is lazy, so the
# image is configuration-agnostic.

ARG NODE_VERSION=20-alpine

# ---------------------------------------------------------------------------
# deps
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

# ---------------------------------------------------------------------------
# builder
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# ---------------------------------------------------------------------------
# migrator (one-off)
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS migrator
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY prisma ./prisma
# DATABASE_URL must be provided at run time.
CMD ["npx", "prisma", "migrate", "deploy"]

# ---------------------------------------------------------------------------
# runner
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner
RUN apk add --no-cache libc6-compat openssl curl
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Static assets and the traced standalone server.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
