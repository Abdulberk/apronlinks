# Multi-stage so the runtime image carries no compiler, no test framework and
# no source: build artefacts and production dependencies only.

FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# --ignore-scripts: the root postinstall runs prisma generate, and this stage
# has no schema yet. The build stage generates the client explicitly.
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm exec prisma generate && rm -rf dist && pnpm exec nest build && test -f dist/main.js && test -f dist/config/env.js

FROM node:22-alpine AS runtime
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production

# pnpm-workspace.yaml is deliberately NOT copied here. The runtime image
# carries only the service, so a workspace file declaring a `web` package whose
# manifest is absent makes pnpm re-resolve the whole tree on every container
# start — a full install, over the network, before the service boots. The
# node_modules copied below is already complete and correct.
COPY package.json pnpm-lock.yaml prisma.config.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/generated ./src/generated
COPY prisma ./prisma

# Migrations run at start rather than at build: the database does not exist
# when the image is built, and a fresh clone must arrive at a seeded, working
# system from one command.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm exec prisma db seed && node dist/main"]
