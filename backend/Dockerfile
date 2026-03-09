# Pin base images by digest for reproducible builds
FROM rust:1.93-bookworm@sha256:1d33950f982ca6411f5e0ee4850be46e03f066f1a9efaeb41922a0e59497c9c2 AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release 2>/dev/null || true
RUN rm -rf src
COPY src/ src/
RUN touch src/main.rs && cargo build --release

FROM debian:bookworm-slim@sha256:74a21da88cf4b2e8fde34558376153c5cd80b00ca81da2e659387e76524edc73
RUN apt-get update && apt-get install -y ca-certificates libsqlite3-0 && rm -rf /var/lib/apt/lists/*
RUN groupadd -g 1000 appuser && useradd -u 1000 -g appuser -d /app appuser
WORKDIR /app
COPY --from=builder /app/target/release/heritage-backend .
EXPOSE 3001
USER appuser
CMD ["./heritage-backend"]
