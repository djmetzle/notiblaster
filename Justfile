set shell := ["bash", "-euo", "pipefail", "-c"]

# Show available recipes.
default:
    @just --list

# Run Fastify and Vite together. NATS must already be up (`just nats`).
dev:
    trap 'kill 0' EXIT; \
    pnpm -F server dev & \
    pnpm -F web dev & \
    wait

# Build the frontend into server/public.
build:
    pnpm -F web build

# Bring up NATS only (for host-run dev).
nats:
    docker compose up -d nats

# Tear down all compose services.
down:
    docker compose down

# Follow NATS logs.
nats-logs:
    docker compose logs -f nats

# Full containerized run: build frontend, then compose up.
up: build
    docker compose up --build

# Publish a message via the HTTP API (for quick manual testing).
publish subject="notify.broadcast" message="hello":
    curl -sS -X POST http://localhost:3000/api/publish \
      -H 'content-type: application/json' \
      -d '{"subject":"{{subject}}","message":"{{message}}"}'
    @echo
