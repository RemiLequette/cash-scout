# Builds the app image: the API serving the built front end.

FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/domain/package.json packages/domain/
RUN pnpm install --frozen-lockfile
COPY . .
# The release being built, shown in About: the image holds no repository to read it from.
ARG APP_VERSION
ENV APP_VERSION=$APP_VERSION
RUN pnpm --filter @cash-scout/web --filter @cash-scout/api build \
 && pnpm --filter @cash-scout/api deploy --prod --legacy /out

FROM node:22-alpine
ENV NODE_ENV=production \
    API_PORT=3000 \
    WEB_DIST=/app/web \
    MIGRATIONS_DIR=/app/drizzle
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle
COPY --from=build /repo/apps/web/dist ./web
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
