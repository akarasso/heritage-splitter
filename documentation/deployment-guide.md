# Deployment Guide

## Local Development (Tilt + Kubernetes)

### Prerequisites
- Docker Desktop with Kubernetes enabled
- [Tilt](https://tilt.dev/) installed
- [Foundry](https://getfoundry.sh/) installed (for smart contracts)
- MetaMask browser extension

### Setup

1. **Clone the repository**
```bash
git clone <repo-url>
cd avalanche_hackathon
```

2. **Configure environment**
```bash
cp backend/.env.example backend/.env
# Edit backend/.env with your values:
# - JWT_SECRET: any random string
# - CERTIFIER_PRIVATE_KEY: Anvil test key (0x prefix)
# - Contract addresses: will be set after deployment
# - MINIO_*: default credentials
```

3. **Start development environment**
```bash
tilt up
```
This will:
- Build and deploy the backend container (port 3001)
- Build and deploy the frontend container (port 8080)
- Deploy MinIO for object storage (ports 9000/9001)
- Create Kubernetes secrets from `backend/.env`
- Set up PVC for SQLite persistence

4. **Deploy smart contracts** (optional, for local Anvil)
```bash
cd blockchain
forge build
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast
```

5. **Access the application**
- Frontend: http://localhost:8080
- Backend API: http://localhost:3001/api
- MinIO Console: http://localhost:9001

### Hot Reload
- **Backend**: Tilt watches `backend/src/**` and rebuilds on change
- **Frontend**: Tilt watches `frontend/src/**` and rebuilds on change
- **Contracts**: Run `forge test` manually or via Tilt trigger

### Database Reset
```bash
# Delete DB and restart pod
kubectl exec <backend-pod> -- rm -f /data/heritage.db /data/heritage.db-shm /data/heritage.db-wal
kubectl delete pod <backend-pod>
# Pod auto-restarts with fresh DB
```

## Production Deployment

### Infrastructure
- Kubernetes cluster (any provider: GKE, EKS, AKS, k3s)
- Domain name with DNS pointing to cluster ingress
- cert-manager installed for TLS certificates

### Deploy

1. **Build and push images**
```bash
docker build -t registry/heritage-backend:v1 ./backend
docker build -t registry/heritage-frontend:v1 ./frontend
docker push registry/heritage-backend:v1
docker push registry/heritage-frontend:v1
```

2. **Create secrets**
```bash
kubectl create secret generic heritage-secrets \
  --from-literal=jwt-secret=<random-secret> \
  --from-literal=certifier-private-key=<key> \
  --from-literal=doc-registry-address=<addr> \
  --from-literal=factory-address=<addr> \
  --from-literal=registry-address=<addr> \
  --from-literal=market-address=<addr> \
  --from-literal=minio-access-key=<key> \
  --from-literal=minio-secret-key=<key>
```

3. **Apply manifests**
```bash
kubectl apply -f k8s/prod/
```

4. **Verify**
```bash
kubectl get pods
kubectl logs -f deployment/backend
```

### Production Configuration

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Random secret for JWT signing |
| `CERTIFIER_PRIVATE_KEY` | Wallet private key for meta-transactions |
| `AVALANCHE_RPC_URL` | Avalanche C-Chain RPC endpoint |
| `DOC_REGISTRY_ADDRESS` | DocumentRegistry contract address |
| `FACTORY_ADDRESS` | CollectionFactory contract address |
| `REGISTRY_ADDRESS` | PaymentRegistry proxy address |
| `MARKET_ADDRESS` | NFTMarket contract address |
| `MINIO_ENDPOINT` | MinIO/S3 endpoint |
| `MINIO_ACCESS_KEY` | S3 access key |
| `MINIO_SECRET_KEY` | S3 secret key |
| `MINIO_BUCKET` | S3 bucket name |

### Smart Contract Deployment (Avalanche Fuji/Mainnet)

```bash
cd blockchain

# Deploy all contracts
forge script script/Deploy.s.sol \
  --rpc-url https://api.avax-test.network/ext/bc/C/rpc \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast \
  --verify

# Note the deployed addresses and update backend config
```

Deploy order:
1. PaymentRegistry (behind TransparentUpgradeableProxy)
2. CollectionFactory
3. NFTMarket
4. DocumentRegistry

## Running Tests

### Smart Contracts
```bash
cd blockchain
forge test -vvv          # All tests with trace
forge test --gas-report  # Gas usage report
```

### Backend
```bash
cd backend
cargo test               # All tests
cargo test -- --nocapture # With output
```

### End-to-End
```bash
cd e2e/playwright
npx playwright test      # All E2E tests
npx playwright test --ui # Interactive UI mode
```
