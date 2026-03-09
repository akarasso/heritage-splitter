#!/usr/bin/env bash
# Run E2E tests using Tilt CI
#
# This script:
#   1. Deploys Anvil + backend + frontend to K8s (namespace: heritage-e2e)
#   2. Runs Playwright tests
#   3. Tears down the infrastructure
#
# Usage: ./e2e/run-e2e.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Use a separate Tilt port to avoid conflict with dev instance
export TILT_PORT="${TILT_PORT:-10360}"

echo "=== Starting E2E infrastructure via Tilt (port $TILT_PORT) ==="
tilt ci -f Tiltfile.e2e
EXIT_CODE=$?

echo "=== Tearing down E2E infrastructure ==="
tilt down -f Tiltfile.e2e 2>/dev/null || true

# Also delete namespace to ensure clean slate
kubectl delete namespace heritage-e2e --ignore-not-found 2>/dev/null || true

exit $EXIT_CODE
