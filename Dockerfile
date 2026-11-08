FROM node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates libpcre2-8-0 && rm -rf /var/lib/apt/lists/*
# pnpm is provided by Corepack; npm's bundled dependency tree is not used by operations.
RUN rm -rf /usr/local/lib/node_modules/npm && rm -f /usr/local/bin/npm /usr/local/bin/npx

FROM base AS build
ENV ORBIT_STANDALONE=1
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Public synthetic build configuration only; runtime secrets are injected at deployment.
RUN mkdir -p public && cp .env.example .env.local && BETTER_AUTH_SECRET=orbit-container-build-synthetic-not-for-runtime pnpm build && rm .env.local && rm -f .next/standalone/.env.local

# One-off migration / maintenance job; never run migrations in web startup.
FROM build AS operations
RUN rm -rf /root/.cache/node/corepack /usr/local/lib/node_modules/corepack && rm -f /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg
USER node
CMD ["node", "--conditions=react-server", "--import", "tsx", "scripts/maintenance-cleanup.ts"]

FROM node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libpcre2-8-0 && rm -rf /var/lib/apt/lists/* /usr/local/lib/node_modules/npm && rm -f /usr/local/bin/npm /usr/local/bin/npx
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
