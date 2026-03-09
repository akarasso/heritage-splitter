#!/bin/bash
set -euo pipefail

# Deploy all smart contracts on Anvil and patch the backend K8s deployment
# with the contract addresses. Called by Tiltfile.e2e as a local_resource.

RPC="http://localhost:18545"
KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

cd "$(dirname "$0")/../blockchain"

# Wait for Anvil to be ready
echo "Waiting for Anvil..."
until cast block-number --rpc-url "$RPC" &>/dev/null; do sleep 0.5; done
echo "Anvil ready"

# Deploy all contracts via forge script
echo "Deploying contracts..."
OUTPUT=$(PRIVATE_KEY=$KEY forge script script/Deploy.s.sol --broadcast --rpc-url "$RPC" 2>&1)

# Parse addresses from console.log output
FACTORY=$(echo "$OUTPUT" | grep "CollectionFactory deployed" | grep -oP '0x[0-9a-fA-F]{40}')
MARKET=$(echo "$OUTPUT" | grep "NFTMarket deployed" | grep -oP '0x[0-9a-fA-F]{40}')
DOC_REG=$(echo "$OUTPUT" | grep "DocumentRegistry deployed" | grep -oP '0x[0-9a-fA-F]{40}')
REGISTRY=$(echo "$OUTPUT" | grep "PaymentRegistry (proxy) deployed" | grep -oP '0x[0-9a-fA-F]{40}')

echo "Factory:  $FACTORY"
echo "Market:   $MARKET"
echo "DocReg:   $DOC_REG"
echo "Registry: $REGISTRY"

# Patch backend deployment with contract addresses
kubectl -n heritage-e2e set env deployment/backend \
  FACTORY_ADDRESS="$FACTORY" \
  MARKET_ADDRESS="$MARKET" \
  DOC_REGISTRY_ADDRESS="$DOC_REG" \
  REGISTRY_ADDRESS="$REGISTRY"

# Wait for backend rollout
kubectl -n heritage-e2e rollout status deployment/backend --timeout=60s

# Write addresses to file for globalSetup
cat > /tmp/e2e-contracts.json <<EOF
{
  "factoryAddr": "$FACTORY",
  "marketAddr": "$MARKET",
  "docRegistryAddr": "$DOC_REG",
  "registryAddr": "$REGISTRY"
}
EOF

echo "Contracts deployed and backend restarted."
