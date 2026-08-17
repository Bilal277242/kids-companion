# Production image for apps/api.
#
# Build from the repository root:
#   docker build -f infra/docker/api.Dockerfile -t kids-companion-api .
#
# Hardening per SECURITY.md §7: non-root, minimal base, no build tooling in the
# runtime layer, no secrets baked in.

# ---------- deps ----------
FROM node:24-alpine AS deps
WORKDIR /repo

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/types/package.json      packages/types/
COPY packages/shared/package.json     packages/shared/
COPY packages/config/package.json     packages/config/
COPY packages/validation/package.json packages/validation/
COPY packages/ui/package.json         packages/ui/
COPY services/ai/package.json         services/ai/
COPY services/voice/package.json      services/voice/
COPY services/payments/package.json   services/payments/
COPY apps/api/package.json            apps/api/

# `--ignore-scripts`: no third-party postinstall runs during an image build.
RUN pnpm install --frozen-lockfile --ignore-scripts

# ---------- build ----------
FROM deps AS build
WORKDIR /repo

COPY tsconfig.base.json tsconfig.json ./
COPY packages/ packages/
COPY services/ services/
COPY apps/api/ apps/api/

RUN pnpm exec tsc -b

# Drop dev dependencies so no compiler or test runner reaches the runtime layer.
RUN pnpm prune --prod

# ---------- runtime ----------
FROM node:24-alpine AS runtime
WORKDIR /repo

# dumb-init reaps zombies and forwards SIGTERM, so graceful shutdown actually
# happens and in-flight turns are not cut off by a deploy.
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production

COPY --from=build --chown=node:node /repo/node_modules      ./node_modules
COPY --from=build --chown=node:node /repo/packages          ./packages
COPY --from=build --chown=node:node /repo/services          ./services
COPY --from=build --chown=node:node /repo/apps/api/dist     ./apps/api/dist
COPY --from=build --chown=node:node /repo/apps/api/package.json ./apps/api/

USER node

EXPOSE 8080

# Liveness only — never touches a dependency, so a slow query cannot restart a
# healthy container. See docs/API_CONVENTIONS.md §10.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/api/dist/server.js"]
