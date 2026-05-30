# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Builder
# Uses the official Rust image to compile a fully optimized release binary.
# ─────────────────────────────────────────────────────────────────────────────
FROM rust:1.78-slim-bookworm AS builder

WORKDIR /app

# Install native build dependencies needed by sqlx and openssl crates
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy manifests first for dependency layer caching.
# This ensures dependencies are only re-downloaded when Cargo.toml changes.
COPY Cargo.toml Cargo.lock build.rs ./

# Copy proto files needed by build.rs at compile time
COPY proto ./proto

# Pre-build deps only (dummy main to cache the layer)
RUN mkdir -p src && echo "fn main() {}" > src/main.rs && \
    cargo build --release && \
    rm -rf src

# Now copy the real source and do the final build
COPY src ./src

# Touch main.rs so Cargo knows to re-link it
RUN touch src/main.rs && cargo build --release

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Minimal Runtime Image
# Copies only the compiled binary into a distroless-style image.
# Final image has NO Rust toolchain, NO source code, NO build tools.
# ─────────────────────────────────────────────────────────────────────────────
FROM debian:bookworm-slim

LABEL maintainer="Axiom Team"
LABEL description="Industrial-grade unified API gateway — built in Rust."

# Runtime deps: ca-certificates for TLS, libsqlite3 for SQLite engine
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only the compiled binary from the builder stage
COPY --from=builder /app/target/release/axiom /app/axiom

# HTTP and gRPC ports
EXPOSE 4500 4501

# Persistent volumes for config, storage, logs, and DB state
VOLUME ["/app/config.toml", "/app/storage", "/app/logs", "/app/data"]

# Run as non-root for security
RUN useradd -r -u 1001 -g root axiom && chown axiom /app/axiom
USER axiom

CMD ["/app/axiom"]
