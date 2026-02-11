# ── Stage 1: Build client ──────────────────────────
FROM node:20-slim AS client-build

WORKDIR /app/client
COPY client/package.json client/package-lock.json* ./
RUN npm ci
COPY client/ .
RUN npm run build

# ── Stage 2: Production server ─────────────────────
FROM node:20-slim AS production

# mediasoup needs build tools for native compilation
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install server dependencies
COPY server/package.json server/package-lock.json* ./server/
WORKDIR /app/server
RUN npm ci --only=production

# Copy server source
COPY server/src ./src

# Copy built client
COPY --from=client-build /app/client/dist /app/client/dist

WORKDIR /app/server

EXPOSE 3001
# UDP/TCP ports for WebRTC media
EXPOSE 40000-40100/udp
EXPOSE 40000-40100/tcp

CMD ["node", "src/index.js"]
