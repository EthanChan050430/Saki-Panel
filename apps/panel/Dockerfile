FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY scripts ./scripts
COPY apps/panel ./apps/panel
COPY apps/daemon ./apps/daemon
COPY prisma ./prisma
RUN npm ci
RUN npm run build -w @webops/shared && npm run build -w @webops/panel && npm run build -w @webops/daemon

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/panel/package.json ./apps/panel/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/panel/dist ./apps/panel/dist
COPY prisma ./prisma
RUN npm ci --omit=dev
COPY --from=build /app/apps/daemon/package.json ./apps/daemon/package.json
COPY --from=build /app/apps/daemon/dist ./apps/daemon/dist
EXPOSE 5479
CMD ["node", "apps/panel/dist/index.js"]
