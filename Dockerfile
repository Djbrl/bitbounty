# Server image (apps/server + the workspace packages it depends on).
FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter "@bitbounty/server..." \
 && pnpm --filter "@bitbounty/server..." build
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
# Run as the unprivileged user of the base image; /app stays root-owned and read-only for it.
USER node
# --conditions: load workspace packages (@bitbounty/core) from their built dist/, not TS source.
CMD ["node", "--conditions=bitbounty-dist", "apps/server/dist/index.js"]
