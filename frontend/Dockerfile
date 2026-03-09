# Pin base images by digest for reproducible builds
FROM node:22-alpine@sha256:92d51e5f20b7ff58faa5a969af1a1cec6cbec3fbff7e0f523242b9b5c85ad887 AS builder
RUN npm install -g pnpm@10.5.2
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_FACTORY_ADDRESS
ARG VITE_DOCUMENT_REGISTRY_ADDRESS
ARG VITE_CHAIN_RPC
ARG VITE_CHAIN_ID
ARG VITE_CHAIN_LABEL
RUN pnpm build

FROM caddy:2-alpine@sha256:a1b7e624f860619cea121bdbc5dec2e112401666298c6507c6793b0a3ee6fc8e
# Strip file capabilities so caddy can run with allowPrivilegeEscalation=false (port 3000 > 1024, no cap needed)
RUN setcap -r /usr/bin/caddy 2>/dev/null || true
RUN addgroup -g 1000 appuser && adduser -u 1000 -G appuser -D appuser && \
    mkdir -p /config/caddy /data/caddy && chown -R appuser:appuser /config /data /srv
COPY --from=builder /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 3000
USER appuser
