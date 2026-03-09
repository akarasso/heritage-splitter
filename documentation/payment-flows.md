# Payment Flows

## Overview

Heritage Splitter handles three types of payment flows, all enforced on-chain:

1. **Primary sale** — Direct purchase from NFTMarket
2. **Showroom sale** — Purchase via producer storefront (base + margin)
3. **Secondary royalties** — ERC-2981 royalties on resales

All flows ultimately route through ArtistsSplitter and PaymentRegistry.

## Primary Sale Flow

```
Buyer sends AVAX
       │
       ▼
NFTMarket.purchase(listingId)
       │
       ├── Validates: listing active, msg.value >= price
       ├── Deactivates listing
       ├── Reads splitter address from CollectionNFT.royaltyInfo()
       │
       ├── Sends full price ──► ArtistsSplitter.receive()
       │                              │
       │                              ├── Artist A (6000 bps = 60%)
       │                              │   └── PaymentRegistry.pay(artistA, 60% of price)
       │                              │
       │                              ├── Artist B (3000 bps = 30%)
       │                              │   └── PaymentRegistry.pay(artistB, 30% of price)
       │                              │
       │                              └── Producer (1000 bps = 10%)
       │                                  └── PaymentRegistry.pay(producer, 10% of price)
       │
       ├── Transfers NFT to buyer (safeTransferFrom)
       │
       └── Refunds overpayment (if msg.value > price)
```

## Showroom Sale Flow

```
Buyer sends AVAX (basePrice + margin)
       │
       ▼
Showroom.purchase(nftContract, tokenId)
       │
       ├── Reads item: market, listingId, margin
       ├── Reads basePrice from NFTMarket listing
       ├── Validates: msg.value >= basePrice + margin
       │
       ├── Sends basePrice ──► NFTMarket.purchaseFor(listingId, buyer)
       │                              │
       │                              └── (same split as primary sale above)
       │                                  NFT transferred to buyer
       │
       ├── Sends margin ──► PaymentRegistry.pay(showroomOwner)
       │                         │
       │                         └── Producer receives margin directly
       │
       └── Refunds overpayment (if any)
```

## Secondary Royalty Flow (ERC-2981)

```
Buyer purchases on external marketplace (OpenSea, Joepegs, etc.)
       │
       ▼
Marketplace calls CollectionNFT.royaltyInfo(tokenId, salePrice)
       │
       └── Returns: (splitterAddress, royaltyAmount)
              │
              ▼
Marketplace sends royaltyAmount ──► ArtistsSplitter.receive()
                                          │
                                          └── (same proportional split as above)
```

**Note**: ERC-2981 is a voluntary standard. Compliant marketplaces will honor royalties automatically. Non-compliant marketplaces may not send royalties.

## PaymentRegistry: Push-First, Pull-Fallback

The PaymentRegistry ensures reliable payment delivery regardless of recipient type:

```
PaymentRegistry.pay(recipient) called with ETH
       │
       ├── Try: send ETH with 2300 gas stipend
       │       │
       │       ├── Success (EOA or simple receive)
       │       │   └── Emit PaymentSent(recipient, amount)
       │       │
       │       └── Failure (contract without receive, or gas exceeded)
       │           └── Store in pendingWithdrawals[recipient]
       │               └── Emit PaymentDeferred(recipient, amount)
       │
       └── Later: recipient calls withdraw()
                  └── Transfer pendingWithdrawals[recipient]
                      └── Emit Withdrawn(recipient, amount)
```

**Why push-first?** Pure pull patterns (like OpenZeppelin PullPayment) require every recipient to manually claim — poor UX for artists who just want to receive payment. Push-first sends ETH immediately. The 2300 gas limit prevents reentrancy attacks while allowing EOAs and simple contracts to receive.

**Why pull-fallback?** Some contract wallets (multisigs, smart accounts) need more than 2300 gas to process incoming ETH. Rather than failing permanently, the payment is stored for manual withdrawal.

## Basis Points System

All allocations use basis points (bps):
- **10,000 bps** = 100%
- **5,000 bps** = 50%
- **1,000 bps** = 10%
- **100 bps** = 1%

Shares must sum to exactly 10,000. The ArtistsSplitter enforces this at deployment time.

Example allocation for a 3-person collection:
```
Lead Artist:    6,000 bps (60%)
Collaborator:   3,000 bps (30%)
Producer:       1,000 bps (10%)
─────────────────────────────────
Total:         10,000 bps (100%)
```

On a 1 AVAX sale:
- Lead Artist receives: 0.6 AVAX
- Collaborator receives: 0.3 AVAX
- Producer receives: 0.1 AVAX

Rounding dust (from integer division) is absorbed by the last beneficiary in the array.

## Gas Costs (Avalanche Fuji Testnet)

| Operation | Estimated Gas | Cost (~25 gwei) |
|---|---|---|
| Deploy collection (Factory) | ~3,500,000 | ~0.0875 AVAX |
| Mint 1 NFT | ~150,000 | ~0.00375 AVAX |
| Mint batch (10 NFTs) | ~800,000 | ~0.02 AVAX |
| List on market | ~100,000 | ~0.0025 AVAX |
| Purchase NFT | ~200,000 | ~0.005 AVAX |
| Deploy showroom | ~2,000,000 | ~0.05 AVAX |
| Showroom purchase | ~300,000 | ~0.0075 AVAX |
| Certify document | ~80,000 | ~0.002 AVAX |
