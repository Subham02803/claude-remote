# ---------------------------------------------------------------------------
# claude-remote
#
# Runs the Fastify server and serves the built web app on one port.
#
# NOTE (read before relying on this): from Step 3 of the implementation plan
# onward, this app drives the `claude` CLI in tmux on the *host* — with the
# host's Max-plan credentials, the host's tmux, and the host's project folders.
# A container does not have any of those. See docs/03-implementation-plan.md
# and the comments in docker-compose.yml for the three ways that can be
# resolved. Today the container is complete, because there is no PTY yet.
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 compiles from source; these are only needed to build it.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

# Manifests first, so a source-only change does not reinstall the world.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/server/package.json      apps/server/
COPY apps/web/package.json         apps/web/
COPY packages/shared/package.json  packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @claude-remote/web build

# No `pnpm prune --prod` here on purpose: in a workspace it removes and
# reinstalls the module directories, and the .bin symlinks do not come back —
# which leaves `tsx: not found` at runtime. The extra image size is worth more
# than the hour that costs to rediscover.

# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

COPY --from=build /app /app

# Loopback inside the container's own namespace would be unreachable from the
# host. What actually limits exposure is the port mapping in docker-compose.yml,
# which publishes to 127.0.0.1 only.
ENV HOST=0.0.0.0 \
    PORT=4180 \
    BIND_ANY=true \
    DATABASE_PATH=/data/claude-remote.db

EXPOSE 4180
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4180/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "--filter", "@claude-remote/server", "start"]
