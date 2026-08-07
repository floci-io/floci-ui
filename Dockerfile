# Stage 1 — build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY packages/frontend/package.json ./
RUN npm install
COPY packages/frontend/ .
RUN npm run build

# Stage 2 — compile API to a self-contained binary
FROM oven/bun:1-alpine AS api-build
WORKDIR /app
COPY packages/api/package.json packages/api/bun.lock* ./
RUN bun install
COPY packages/api/src ./src
RUN bun build --compile --minify src/index.ts --outfile server

# Stage 3 — minimal runtime (no bun, no node_modules)
FROM alpine:3
RUN apk add --no-cache ca-certificates libstdc++
WORKDIR /app
COPY --from=api-build /app/server ./server
COPY --from=frontend-build /app/dist ./public
ENV PORT=4500
EXPOSE 4500
CMD ["./server"]
