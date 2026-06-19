FROM node:22-alpine AS base
RUN apk add --no-cache openssh-client postgresql-client curl
WORKDIR /app

# ---- Dependencies layer ----
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# ---- Build layer ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate
RUN npm run build

# ---- Runtime layer (distroless-like, minimal) ----
FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Security: run as non-root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S -u 1001 -G nodejs nextjs

# Copy only what's needed
COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=build --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma

# Agent bundles for download (Bash + Python)
COPY --from=build --chown=nextjs:nodejs /app/agents ./agents

USER nextjs
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
