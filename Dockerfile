# SalesFlow production image (docs/deployment.md).
#   docker build -t salesflow .                       # application (target: runtime)
#   docker build -t salesflow-migrate --target migrate .   # one-off migration job
# No secrets are baked in: every credential comes from the environment at run time.

ARG NODE_IMAGE=node:24.11.1-slim

# ---- dependencies (all, for building) ---------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/*
# Placeholder so `prisma generate` (postinstall) can load prisma.config.ts; never used to connect.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

# ---- build -----------------------------------------------------------------
FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build

# ---- migration job (has the Prisma CLI; run once per release, before the app) ----
FROM deps AS migrate
ENV NODE_ENV=production
COPY prisma ./prisma
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

# ---- runtime ---------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=deps /app/package.json /app/package-lock.json ./
COPY --from=deps /app/prisma.config.ts ./
COPY --from=deps /app/prisma ./prisma
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm ci --omit=dev --no-audit --no-fund --ignore-scripts && npm cache clean --force
COPY --from=build /app/src/generated ./src/generated
COPY --from=build /app/.next ./.next
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/scripts/preflight.mjs ./scripts/preflight.mjs
COPY --from=build /app/src/server/config-check.ts ./src/server/config-check.ts
USER node
EXPOSE 3000
# Readiness: 200 only when the database answers and no migration has failed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# `next start` drains in-flight requests on SIGTERM (allow 30 s before SIGKILL, e.g. docker stop -t 30).
# The preflight refuses to start on configuration errors; exec hands signals to Next.js.
CMD ["sh", "-c", "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/preflight.mjs && exec node_modules/.bin/next start"]
