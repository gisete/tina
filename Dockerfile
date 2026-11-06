# syntax=docker/dockerfile:1
# Tina production image. The build needs NO secrets and NO database:
# every route that touches the DB is dynamic (rendered per request).

# ---- base: Node LTS slim, tzdata so the zone resolves, timezone enforced ----
FROM node:22-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata \
 && rm -rf /var/lib/apt/lists/*
ENV TZ=Europe/Lisbon \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ---- deps: install from the lockfile only ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: next build -> .next/standalone ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runtime: standalone server only, non-root ----
FROM base AS runtime
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
RUN groupadd --system --gid 1001 tina \
 && useradd --system --uid 1001 --gid tina --no-create-home tina
COPY --from=build --chown=tina:tina /app/.next/standalone ./
COPY --from=build --chown=tina:tina /app/.next/static ./.next/static
COPY --from=build --chown=tina:tina /app/public ./public
USER tina
EXPOSE 3000
CMD ["node", "server.js"]
