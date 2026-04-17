FROM node:22-alpine

WORKDIR /app

RUN corepack enable

# Workspace root manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json ./server/
COPY web/package.json ./web/

RUN pnpm install --frozen-lockfile

COPY server ./server

RUN pnpm -F server build

WORKDIR /app/server
ENV NODE_ENV=production

EXPOSE 3000
CMD ["node", "dist/index.js"]
