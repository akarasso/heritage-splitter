#!/usr/bin/env bash
# Heritage Splitter — Deploy to OVH Kubernetes
# Usage: ./scripts/ovh-deploy.sh [--init] [--db-reset] [--build]
#
# Options:
#   --init      First-time setup (namespace, secrets, PVC, registry credentials)
#   --build     Build & push Docker images before deploying
#   --db-reset  Wipe the database (delete PVC + recreate)
#   (no flag)   Just deploy/update the app

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export KUBECONFIG="${KUBECONFIG:-$ROOT/kubeconfig-ah0t12.yml}"

REGISTRY="97ksui70.c1.gra9.container-registry.ovh.net"
PROJECT="heritage-splitter"
NS="heritage"

# ── Colors ─────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ── Parse args ─────────────────────────────────────────────────────
DO_INIT=false
DO_BUILD=false
DO_DB_RESET=false

for arg in "$@"; do
  case "$arg" in
    --init)     DO_INIT=true ;;
    --build)    DO_BUILD=true ;;
    --db-reset) DO_DB_RESET=true ;;
    *) error "Unknown arg: $arg"; exit 1 ;;
  esac
done

# ── Verify connectivity ───────────────────────────────────────────
info "Checking cluster connectivity..."
if ! kubectl cluster-info &>/dev/null; then
  error "Cannot connect to cluster. Check KUBECONFIG."
  exit 1
fi
ok "Cluster reachable"

# ── Init (first time only) ────────────────────────────────────────
if $DO_INIT; then
  info "Creating namespace '$NS'..."
  kubectl apply -f "$ROOT/k8s/prod/namespace.yaml"

  info "Creating registry pull secret..."
  if ! kubectl get secret ovh-registry -n "$NS" &>/dev/null; then
    echo ""
    echo -e "${YELLOW}Registry credentials needed for: ${REGISTRY}${NC}"
    read -rp "Registry username [TEaqZokgnH]: " REG_USER
    REG_USER="${REG_USER:-TEaqZokgnH}"
    read -rsp "Registry password: " REG_PASS
    echo ""
    kubectl create secret docker-registry ovh-registry \
      --namespace="$NS" \
      --docker-server="$REGISTRY" \
      --docker-username="$REG_USER" \
      --docker-password="$REG_PASS"
    ok "Registry secret created"
  else
    ok "Registry secret already exists"
  fi

  info "Creating secrets..."
  echo ""
  echo -e "${YELLOW}JWT secret for token signing:${NC}"
  read -rsp "JWT_SECRET (press Enter for auto-generated): " JWT_SEC
  echo ""
  if [ -z "$JWT_SEC" ]; then
    JWT_SEC=$(openssl rand -hex 32)
    info "Auto-generated JWT secret"
  fi
  kubectl apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: heritage-secrets
  namespace: $NS
type: Opaque
stringData:
  jwt-secret: "$JWT_SEC"
EOF
  ok "Secrets configured"

  info "Creating PersistentVolumeClaim..."
  kubectl apply -f "$ROOT/k8s/prod/pvc.yaml"
  ok "PVC created (1Gi csi-cinder-high-speed)"

  echo ""
  ok "Init complete! Run again with --build to build & deploy."
  exit 0
fi

# ── Database reset (destructive!) ─────────────────────────────────
if $DO_DB_RESET; then
  warn "This will DELETE all data in the database!"
  read -rp "Type 'yes' to confirm: " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    error "Aborted."; exit 1
  fi

  info "Scaling down backend..."
  kubectl scale deployment backend -n "$NS" --replicas=0 2>/dev/null || true
  sleep 3

  info "Deleting PVC..."
  kubectl delete pvc heritage-db -n "$NS" --ignore-not-found
  sleep 2

  info "Recreating PVC..."
  kubectl apply -f "$ROOT/k8s/prod/pvc.yaml"
  ok "PVC recreated. Backend will auto-migrate on next deploy."

  info "Scaling backend back up..."
  kubectl scale deployment backend -n "$NS" --replicas=1 2>/dev/null || true
  ok "Database reset complete. Backend will create fresh tables on startup."
  exit 0
fi

# ── Build & push images ───────────────────────────────────────────
if $DO_BUILD; then
  TAG="${TAG:-latest}"
  BACKEND_IMG="$REGISTRY/$PROJECT/heritage-backend:$TAG"
  FRONTEND_IMG="$REGISTRY/$PROJECT/heritage-frontend:$TAG"

  info "Logging into registry..."
  docker login "$REGISTRY"

  info "Building backend image..."
  docker build -t "$BACKEND_IMG" "$ROOT/backend"
  ok "Backend image built"

  info "Building frontend image..."
  docker build -t "$FRONTEND_IMG" "$ROOT/frontend"
  ok "Frontend image built"

  info "Pushing images..."
  docker push "$BACKEND_IMG"
  docker push "$FRONTEND_IMG"
  ok "Images pushed to $REGISTRY/$PROJECT"
fi

# ── Deploy ─────────────────────────────────────────────────────────
info "Deploying to namespace '$NS'..."

kubectl apply -f "$ROOT/k8s/prod/namespace.yaml"
kubectl apply -f "$ROOT/k8s/prod/backend.yaml"
kubectl apply -f "$ROOT/k8s/prod/frontend.yaml"

info "Restarting pods to pull latest images..."
kubectl rollout restart deployment/backend -n "$NS"
kubectl rollout restart deployment/frontend -n "$NS"

info "Waiting for rollout..."
kubectl rollout status deployment/backend -n "$NS" --timeout=120s
kubectl rollout status deployment/frontend -n "$NS" --timeout=60s

ok "Deployment complete!"

# ── Show status ────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}=== Deployment Status ===${NC}"
kubectl get pods -n "$NS" -o wide
echo ""

# Get LoadBalancer IP
LB_IP=$(kubectl get svc frontend -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
if [ -n "$LB_IP" ]; then
  echo -e "${GREEN}Public IP: ${LB_IP}${NC}"
  echo -e "Site: http://${LB_IP}"
  echo ""
  echo -e "${YELLOW}Pour Cloudflare:${NC}"
  echo -e "  DNS A record -> ${LB_IP}"
else
  warn "LoadBalancer IP not yet assigned. Run 'make ovh-status' to check."
fi
