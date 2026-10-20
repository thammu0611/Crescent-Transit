# Backend + built web app in one image.
#   docker build -t crescent-transit .
#   docker run -p 4000:4000 -e JWT_SECRET=change-me -e DATABASE_URL=postgres://... crescent-transit
# Without DATABASE_URL the embedded database is kept in /data (mount a volume there).

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production \
    PORT=4000 \
    PGLITE_DIR=/data/pgdata
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/client/dist ./client/dist
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY data ./data
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
# 4000: web app and API. 5023 / 5027: GPS trackers (GT06, Teltonika), used
# only when GPS_GT06_PORT / GPS_TELTONIKA_PORT are set.
EXPOSE 4000 5023 5027
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
