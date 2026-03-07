#!/usr/bin/env bash
# Heritage Splitter — Check wallet balances on Avalanche
# Usage:
#   ./scripts/balances.sh              # Fuji testnet (default)
#   ./scripts/balances.sh mainnet      # Mainnet

set -euo pipefail

NETWORK="${1:-fuji}"

case "$NETWORK" in
  fuji|testnet)
    RPC="https://api.avax-test.network/ext/bc/C/rpc"
    EXPLORER="https://testnet.snowtrace.io/address"
    LABEL="Avalanche Fuji Testnet"
    ;;
  mainnet|main)
    RPC="https://api.avax.network/ext/bc/C/rpc"
    EXPLORER="https://snowtrace.io/address"
    LABEL="Avalanche Mainnet"
    ;;
  *)
    # Custom RPC URL
    RPC="$NETWORK"
    EXPLORER=""
    LABEL="Custom ($NETWORK)"
    ;;
esac

echo "═══════════════════════════════════════════════════════"
echo "  Heritage Splitter — Wallet Balances"
echo "  Network: $LABEL"
echo "═══════════════════════════════════════════════════════"
echo ""

WALLETS=(
  "Backend (minter)|0xbC03569e83d37Af715Ce0FF1997C6245c8A36d58"
  "Pierre Durand (producer)|0x2D641F4Aa137787e3BD34B132bb21E54c437eF6F"
  "Marie Lefevre (artist)|0x1BbC56f627b1e759AFc79eEC651a840fF8D09621"
  "Galerie Rive Gauche|0x1c3cA0b7d45A4DcfE0E25F83b7731f523F564C38"
)

for entry in "${WALLETS[@]}"; do
  IFS='|' read -r name addr <<< "$entry"
  balance_wei=$(cast balance "$addr" --rpc-url "$RPC" 2>/dev/null || echo "ERROR")

  if [[ "$balance_wei" == "ERROR" ]]; then
    balance_fmt="  error"
  else
    balance_fmt=$(cast from-wei "$balance_wei" 2>/dev/null || echo "$balance_wei wei")
  fi

  printf "  %-28s %s\n" "$name" "$addr"
  printf "  %-28s %s AVAX\n" "" "$balance_fmt"
  if [[ -n "$EXPLORER" ]]; then
    printf "  %-28s %s/%s\n" "" "$EXPLORER" "$addr"
  fi
  echo ""
done
