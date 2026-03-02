# Multi-stage build for Hush Client (WASM crypto + React SPA)
# Build from repo root: docker build -f client/Dockerfile .
#
# Stage 1: Compile hush-crypto Rust crate to WASM
# Stage 2: Install JS deps and build Vite SPA
# Stage 3: Serve static files with Caddy

# --- Stage 1: WASM build ---
FROM rust:1.86-slim AS wasm-builder
RUN cargo install wasm-pack
WORKDIR /build
COPY hush-crypto/ ./hush-crypto/
RUN wasm-pack build hush-crypto/ --target web --out-dir /wasm-out

# --- Stage 2: Vite build ---
FROM node:22-alpine AS client-builder
WORKDIR /app

COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client/ .
COPY --from=wasm-builder /wasm-out/ ./src/wasm/
RUN npm run build

# --- Stage 3: Caddy serve ---
FROM caddy:2-alpine
COPY --from=client-builder /app/dist /srv
