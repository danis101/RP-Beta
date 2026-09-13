# =============================================================================
# RP — multi-stage build
#   Stage 1 (node): buduje frontend (React + Vite) do statyków
#   Stage 2 (bun):  uruchamia backend (Hono + SQLite) i serwuje statyki
# =============================================================================

# --- Stage 1: build frontendu ---
FROM node:20-alpine AS frontend-builder

WORKDIR /frontend

# Najpierw tylko manifesty — cache warstwy zależności
COPY frontend/package.json ./
RUN npm install

# Potem źródła i build
COPY frontend/ ./
COPY shared/ /shared/
RUN npm run build

# --- Stage 2: runtime backendu ---
FROM oven/bun:1-alpine

WORKDIR /app

# Zależności backendu
COPY sync/package.json ./
RUN bun install --production

# Źródła backendu
COPY sync/tsconfig.json ./
COPY sync/src ./src
COPY shared/ /shared/

# Statyki frontendu z stage 1 → /app/public
COPY --from=frontend-builder /frontend/dist ./public

ENV NODE_ENV=production
ENV DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8787

CMD ["bun", "src/index.ts"]
