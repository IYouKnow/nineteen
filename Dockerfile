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
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/nineteen-server .

# ---------- Stage 3: runtime ----------
FROM alpine:3.20
RUN apk add --no-cache \
    ca-certificates \
    git \
    docker-cli \
    docker-cli-compose

WORKDIR /app
COPY --from=build-go /out/nineteen-server ./nineteen-server
COPY --from=build-web /app/dist ./static
RUN mkdir -p /app/data

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://localhost:8080/api/health || exit 1

CMD ["./nineteen-server"]
