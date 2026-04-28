FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/daemon ./apps/daemon
RUN npm ci
RUN npm run build -w @webops/shared && npm run build -w @webops/daemon

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/daemon/package.json ./apps/daemon/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/daemon/dist ./apps/daemon/dist
RUN npm ci --omit=dev
EXPOSE 24444
CMD ["node", "apps/daemon/dist/index.js"]
