# Architecture Overview

## System Architecture

Heritage Splitter follows a **three-tier architecture** with a clear separation between the presentation layer (SolidJS), the application layer (Rust/Axum), and the blockchain layer (Solidity smart contracts on Avalanche).

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (SolidJS)                       │
│  Wallet Connection ─── API Client ─── Real-time WebSocket       │
│  MetaMask/Web3-Onboard    REST          Notifications           │
└──────────────┬───────────────┬──────────────────┬───────────────┘
               │               │                  │
               │          ┌────▼────┐             │
               │          │  Caddy  │ reverse     │
               │          │  Proxy  │ proxy       │
               │          └────┬────┘             │
               │               │                  │
┌──────────────▼───────────────▼──────────────────▼───────────────┐
│                     BACKEND (Rust / Axum)                        │
│                                                                  │
│  Auth ── Projects ── Collections ── Showrooms ── Documents       │
│   │         │            │              │            │            │
│   JWT    CRUD +       Deploy +       Deploy +    Encrypt +       │
│   Nonce  Collab       Mint           Margins     Certify         │
│                                                                  │
│  ┌──────────┐  ┌──────────────┐  ┌────────────┐  ┌───────────┐  │
│  │  SQLite  │  │  MinIO (S3)  │  │   Ethers   │  │ WebSocket │  │
│  │    DB    │  │   Storage    │  │  Provider  │  │  Notifier │  │
│  └──────────┘  └──────────────┘  └─────┬──────┘  └───────────┘  │
└────────────────────────────────────────┬────────────────────────┘
                                         │
┌────────────────────────────────────────▼────────────────────────┐
│                  AVALANCHE C-CHAIN (Solidity)                    │
│                                                                  │
│  CollectionFactory ──► CollectionNFT + ArtistsSplitter           │
│                              │               │                   │
│                         NFTMarket ◄──── Showroom                 │
│                              │               │                   │
│                         PaymentRegistry ◄────┘                   │
│                                                                  │
│                      DocumentRegistry                            │
└─────────────────────────────────────────────────────────────────┘
```

## Component Breakdown

### Frontend (SolidJS + TypeScript)
- **Wallet integration**: Web3-Onboard v3 for MetaMask connection, viem for contract reads
- **API client**: Typed REST client with JWT auth, token expiry checking, request deduplication
- **Real-time**: WebSocket connection for notifications, messages, status changes
- **Routing**: Role-based routing — producers cannot access project pages, artists see full navigation
- **State management**: SolidJS signals and resources (fine-grained reactivity, no Redux)

### Backend (Rust + Axum)
- **10 route modules**: auth, users, projects, participants, allocations, collections, showrooms, documents, images, public
- **80+ REST endpoints** with JWT middleware and rate limiting
- **Blockchain service**: ethers-rs provider for contract deployment, minting, listing management
- **Document service**: AES-256-GCM encryption, SHA-256 hashing, EIP-712 certification relay
- **Storage service**: S3-compatible MinIO client for images and documents
- **WebSocket server**: Broadcast channel for real-time event distribution
- **Audit service**: Structured logging of sensitive operations

### Smart Contracts (Solidity 0.8.22)
Seven contracts forming the on-chain backbone — see [Smart Contracts](smart-contracts.md) for full details.

### Infrastructure
- **Kubernetes**: Deployment manifests for backend, frontend, MinIO
- **Tilt**: Hot-reload development environment with live container updates
- **Caddy**: Reverse proxy serving static frontend + proxying `/api` to backend
- **MinIO**: S3-compatible object storage for images and encrypted documents

## On-chain vs Off-chain

| On-chain (Immutable, Trustless) | Off-chain (Flexible, Fast) |
|---|---|
| NFT ownership & transfers (ERC-721) | User profiles & KYC data |
| Revenue splitting (ArtistsSplitter) | Project collaboration workflow |
| Royalty enforcement (ERC-2981) | Allocation negotiation & approval |
| Primary marketplace (NFTMarket) | NFT metadata & images (MinIO) |
| Showroom purchases & margins | Document encryption (AES-256-GCM) |
| Payment registry (push/pull) | Discussions & direct messages |
| Document certification timestamps | Real-time notifications (WebSocket) |
| Collection factory & deployment | Showroom curation & invitations |

**Guiding principle:** Financial logic is always on-chain (trustless, verifiable). Collaboration workflows remain off-chain for flexibility and user experience. The backend acts as a facilitator — it deploys contracts, mints NFTs, and relays transactions, but it **never holds or controls user funds**.

## Key Workflows

### Collection Deployment
```
Artist clicks "Deploy"
  → Backend calls CollectionFactory.createCollection(name, symbol, wallets, shares, royaltyBps)
    → Factory deploys CollectionNFT + ArtistsSplitter (linked)
    → Backend mints NFTs via CollectionNFT.mintBatch(uris[])
    → Backend approves NFTMarket via setApprovalForAll()
    → Backend lists NFTs via NFTMarket.listBatch(prices[])
  → Contract addresses stored in DB
  → Collection status → "deployed"
```

### Showroom Deployment
```
Producer clicks "Deploy"
  → Backend calls deploy Showroom(producer_wallet, registry_address)
    → Showroom contract created with owner = producer
    → Backend calls addItemBatch(nfts, tokenIds, markets, listingIds, margins)
  → Contract address stored in DB
  → Showroom status → "deployed"
```

### Document Certification
```
User uploads document
  → Backend computes SHA-256 hash
  → Backend encrypts with AES-256-GCM, stores in MinIO
  → User triggers "Certify"
    → Backend gets certifier's EIP-712 nonce
    → Frontend signs typed data (hash, certifier, nonce, deadline)
    → Backend calls DocumentRegistry.certifyFor(hash, certifier, deadline, signature)
  → Timestamp stored on-chain
  → Public verification: GET /api/public/verify-document/{hash}
```
