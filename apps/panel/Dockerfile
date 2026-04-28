FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/panel ./apps/panel
COPY prisma ./prisma
RUN npm ci
RUN npm run build -w @webops/shared && npm run build -w @webops/panel

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
EXPOSE 23333
CMD ["node", "apps/panel/dist/index.js"]
