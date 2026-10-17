# Server image (apps/server + the workspace packages it depends on).
FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter "@bitbounty/server..." \
 && pnpm --filter "@bitbounty/server..." build
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
CMD ["node", "apps/server/dist/index.js"]
