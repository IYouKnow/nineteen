# syntax=docker/dockerfile:1

# ---------- Stage 1: build the frontend ----------
FROM node:20-alpine AS build-web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html ./
COPY vite.config.js jsconfig.json postcss.config.js tailwind.config.js components.json ./
COPY src ./src
RUN npm run build

# ---------- Stage 2: build the Go server ----------
FROM golang:1.22-alpine AS build-go
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
# VERSION is injected at build time so the server can report its own version
# (used by the self-update feature). Pass it via --build-arg VERSION=<tag>.
ARG VERSION=dev
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w -X main.version=$VERSION" -o /out/nineteen-server .

# ---------- Stage 3: runtime ----------
FROM alpine:3.20
RUN apk add --no-cache \
    ca-certificates \
    git \
    docker-cli \
    docker-cli-compose

# Install the buildx CLI plugin (officially recommended Dockerfile method).
# The binary is copied for the target architecture, so multi-arch builds work.
COPY --from=docker/buildx-bin /buildx /usr/libexec/docker/cli-plugins/docker-buildx
RUN chmod +x /usr/libexec/docker/cli-plugins/docker-buildx \
    && docker buildx version

WORKDIR /app
COPY --from=build-go /out/nineteen-server ./nineteen-server
COPY --from=build-web /app/dist ./static
RUN mkdir -p /app/data

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://localhost:8080/api/health || exit 1

CMD ["./nineteen-server"]
