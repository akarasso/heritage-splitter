# Heritage Splitter — Tilt Development Environment
# Usage: make dev-up  (ou tilt up)
#
# Services:
#   - Backend  → http://localhost:3001
#   - Frontend → http://dev.heritage-splitter.test
#   - Public   → http://dev.public.heritage-splitter.test

# ─── Read backend/.env → generate k8s secret ────────────────────────
def parse_dotenv(path):
    content = str(read_file(path))
    env = {}
    for line in content.strip().split('\n'):
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, val = line.split('=', 1)
            env[key.strip()] = val.strip()
    return env

_env = parse_dotenv('backend/.env')

k8s_yaml(blob("""
apiVersion: v1
kind: Secret
metadata:
  name: heritage-secrets
type: Opaque
stringData:
  jwt-secret: "%s"
  certifier-private-key: "%s"
  doc-registry-address: "%s"
  factory-address: "%s"
  registry-address: "%s"
""" % (
    _env.get('JWT_SECRET', 'dev-secret'),
    _env.get('CERTIFIER_PRIVATE_KEY', ''),
    _env.get('DOC_REGISTRY_ADDRESS', ''),
    _env.get('FACTORY_ADDRESS', ''),
    _env.get('REGISTRY_ADDRESS', ''),
)))

# ─── Backend ─────────────────────────────────────────────────────────
docker_build(
    'heritage-backend',
    './backend',
    dockerfile='./backend/Dockerfile',
    ignore=['**/*.tmp.*', '**/*~', '**/*.swp'],
)

k8s_yaml('k8s/pvc.yaml')
k8s_yaml('k8s/backend.yaml')
k8s_resource(
    'backend',
    port_forwards=['3001:3001'],
    labels=['backend'],
    resource_deps=[],
)

# ─── Frontend ────────────────────────────────────────────────────────
docker_build(
    'heritage-frontend',
    './frontend',
    dockerfile='./frontend/Dockerfile',
    ignore=['**/*.tmp.*', '**/*~', '**/*.swp', 'node_modules'],
)

k8s_yaml('k8s/frontend.yaml')
k8s_yaml('k8s/ingress.yaml')
k8s_resource(
    'frontend',
    labels=['frontend'],
    resource_deps=['backend'],
)

# ─── Smart Contracts (test runner) ───────────────────────────────────
local_resource(
    'contracts-test',
    cmd='cd blockchain && forge test --summary',
    deps=['blockchain/src'],
    labels=['blockchain'],
    auto_init=False,
    trigger_mode=TRIGGER_MODE_MANUAL,
)
