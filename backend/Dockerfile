FROM node:24.14.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
RUN npm ci --omit=dev --workspace @gx404/backend --ignore-scripts && npm cache clean --force
COPY backend/src backend/src
COPY backend/migrations backend/migrations
COPY backend/scripts backend/scripts
COPY shared shared
RUN mkdir -p /app/backend/data && chown -R node:node /app/backend/data
USER node
ENV HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/app/backend/data/memberships.sqlite
EXPOSE 3000
CMD ["node","backend/src/index.ts"]
