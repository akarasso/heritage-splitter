# Heritage Splitter

**Automated on-chain revenue splitting for collaborative art.**

Artists create together. Smart contracts split the money. No intermediary. No trust required.

---

## The Problem

When multiple artists collaborate on a collection, revenue distribution is a nightmare: manual transfers, opaque gallery commissions, no royalty enforcement, and expensive legal intermediaries. Someone always gets shortchanged.

## The Solution

Heritage Splitter deploys a **payment splitter contract** alongside every NFT collection. Every sale — primary or secondary — is split automatically according to pre-agreed allocations. The producer takes a transparent margin. The artists get paid instantly. Everything is verifiable on-chain.

---

## How the Money Flows

### Direct Sale

```
                         Buyer pays 1 AVAX
                               │
                               ▼
                     ┌─────────────────┐
                     │    NFTMarket     │
                     │   (escrow +     │
                     │    purchase)    │
                     └────────┬────────┘
                              │
                    NFT ──► Buyer's wallet
                              │
                      1 AVAX ──► ArtistsSplitter
                              │
                 ┌────────────┼────────────┐
                 │            │            │
                 ▼            ▼            ▼
            Artist A     Artist B     Producer
            60% (0.6)    30% (0.3)   10% (0.1)
                 │            │            │
                 └────────────┼────────────┘
                              │
                              ▼
                     PaymentRegistry
                  (push-first, pull-fallback)
```

### Showroom Sale (with producer margin)

```
               Buyer pays 1.5 AVAX (base + margin)
                               │
                               ▼
                     ┌─────────────────┐
                     │    Showroom     │
                     │   (producer    │
                     │   storefront)  │
                     └───────┬─┬───────┘
                             │ │
              ┌──────────────┘ └──────────────┐
              │                               │
      1 AVAX (base price)             0.5 AVAX (margin)
              │                               │
              ▼                               ▼
        NFTMarket ──► ArtistsSplitter   PaymentRegistry
              │              │                │
        NFT ──► Buyer   60/30/10 split   ──► Producer
```

### Secondary Royalties (ERC-2981)

```
     Resale on OpenSea, Joepegs, etc.
                    │
                    ▼
     Marketplace reads CollectionNFT.royaltyInfo()
                    │
                    └──► ArtistsSplitter
                              │
                    Same proportional split
                    to all original creators
```

> **Guiding principle:** Financial logic is always on-chain. The backend facilitates (deploys, mints, lists) but **never holds or controls user funds**.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    FRONTEND (SolidJS)                     │
│     MetaMask ─── REST API Client ─── WebSocket           │
└──────────┬──────────────┬──────────────────┬─────────────┘
           │              │                  │
      ┌────▼────┐         │                  │
      │  Caddy  │         │                  │
      └────┬────┘         │                  │
           │              │                  │
┌──────────▼──────────────▼──────────────────▼─────────────┐
│                  BACKEND (Rust / Axum)                     │
│                                                           │
│  Auth ── Projects ── Collections ── Showrooms ── Docs     │
│                                                           │
│  SQLite │ MinIO (S3) │ ethers-rs │ WebSocket              │
└──────────────────────────┬────────────────────────────────┘
                           │
┌──────────────────────────▼────────────────────────────────┐
│               AVALANCHE C-CHAIN (Solidity)                │
│                                                           │
│  CollectionFactory ──► CollectionNFT + ArtistsSplitter    │
│                              │               │            │
│                         NFTMarket ◄──── Showroom          │
│                              │               │            │
│                         PaymentRegistry ◄────┘            │
│                                                           │
│                      DocumentRegistry                     │
└───────────────────────────────────────────────────────────┘
```

## Smart Contracts (7 contracts, 94 tests)

| Contract | Role |
|---|---|
| **CollectionFactory** | Deploys paired NFT + Splitter contracts in one transaction |
| **CollectionNFT** | ERC-721 with ERC-2981 royalties, batch mint/burn |
| **ArtistsSplitter** | Receives ETH, splits proportionally to all beneficiaries |
| **NFTMarket** | Multi-collection primary marketplace with escrow |
| **Showroom** | Producer storefront — wraps market listings with margin |
| **PaymentRegistry** | Push-first, pull-fallback payment delivery (upgradeable) |
| **DocumentRegistry** | On-chain document certification via EIP-712 meta-transactions |

---

## Tech Stack

| Layer | Tech | Why |
|---|---|---|
| Frontend | **SolidJS** + TypeScript | Fine-grained reactivity, 7KB bundle, no virtual DOM |
| Wallet | **Web3-Onboard** + viem | Type-safe contract reads, framework-agnostic |
| Backend | **Rust** + Axum | Zero-cost async, memory safety, 80+ endpoints |
| Database | **SQLite** + sqlx | Compile-time verified SQL, zero-config deployment |
| Storage | **MinIO** | S3-compatible, self-hosted, images + encrypted docs |
| Contracts | **Solidity 0.8.22** + Foundry | Native fuzzing, fast compilation, Solidity-native tests |
| Chain | **Avalanche C-Chain** | Sub-second finality, ~$0.01 tx fees, full EVM |
| Infra | **Kubernetes** + Tilt | Hot-reload dev, same manifests for dev and prod |

---

## Key Features

**For Artists**
- Create collections, invite collaborators, define allocation splits (basis points)
- Collaborative approval workflow — all participants validate before deployment
- Gasless minting and document certification (backend pays gas)
- Automatic revenue distribution on every sale

**For Producers**
- Create showrooms (digital storefronts), curate artist collections
- Set margins on top of base prices
- Deploy as on-chain contract, publish shareable public sale pages
- Anyone can buy — no account needed, just MetaMask

**For Buyers**
- Browse public sale pages, connect wallet, buy in one click
- NFT transferred directly to wallet
- Verify ownership on-chain via Snowtrace

**Platform**
- Wallet-based auth (no passwords)
- Real-time WebSocket notifications
- Threaded discussions and direct messaging
- On-chain document certification (SHA-256 + EIP-712)
- AES-256-GCM encrypted document storage

---

## Collection Lifecycle

```
  draft ──► pending_approval ──► approved ──► ready_to_deploy ──► deployed
    │              │                                                  │
    ◄──────────────┘                                                  │
    (any edit resets to draft)                              (can add new NFTs)
                                                                      │
                                                     pending_mint_approval
                                                           │
                                                      mint_ready ──► mint
```

Solo projects (no collaborators) skip the approval step entirely.

---

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) (1.93+)
- [Node.js](https://nodejs.org/) (20+) + pnpm
- [Foundry](https://getfoundry.sh/) (forge, anvil)
- [Tilt](https://tilt.dev/) + kubectl (for full stack)
- MetaMask browser extension

### Local Development (Tilt)

```bash
# Start the full stack (backend, frontend, MinIO, caddy)
tilt up
```

### Run Tests

```bash
# Smart contract tests
cd blockchain && forge test

# Backend tests
cd backend && cargo test

# End-to-end tests
cd e2e/playwright && npx playwright test
```

---

## Test Coverage

**146 tests** across 3 layers — from Solidity unit tests to full browser E2E.

| Layer | Framework | Tests | What's covered |
|---|---|---|---|
| Smart Contracts | Foundry | **94** | Deploy, mint, batch mint, purchase, split, delist, showroom margins, refunds, document certification, reentrancy, access control, EIP-712 |
| Backend API | Rust (cargo test) | **19** | Showroom CRUD, listings, participants, invitations, auth guards, ownership checks |
| End-to-End | Playwright | **33** | Full browser journeys with 4 user personas (2 artists, 1 producer, 1 buyer) |

### Smart Contract Tests (94) — Foundry

7 test suites covering every contract interaction:

| Suite | Tests | Scope |
|---|---|---|
| CollectionFactory | ~15 | Factory deploy, registry auth, owner collections |
| CollectionNFT | ~10 | Mint, batch mint, burn, royalty info, minter role |
| ArtistsSplitter | ~8 | Payment distribution, rounding dust, rescue ETH |
| NFTMarket | ~20 | List, purchase, delist, price update, refunds, access control |
| Showroom | ~18 | Items, margins, purchase flow, refunds, batch ops |
| PaymentRegistry | ~15 | Push/pull, deferred payments, withdraw, proxy upgrade |
| DocumentRegistry | ~8 | Certify, certifyFor, EIP-712 signatures, nonce replay |

Edge cases tested: reentrancy attacks, integer overflow, zero values, max batch size (100 items), unauthorized access, duplicate wallets.

### End-to-End Tests (33) — Playwright

Real browser tests with 4 authenticated users, a local Anvil chain, and the full backend. Each chapter builds on the previous state:

| Chapter | Tests | Scenario |
|---|---|---|
| 1. Project | 3 | Create project, verify dashboard |
| 2. Collection | 3 | Create collection, add draft NFTs |
| 3. Allocations | 3 | Define splits, assign participants |
| 4. Approval & Deploy | 4 | Submit, approve, deploy on-chain |
| 5. Verify Mint | 3 | Check minted NFTs, on-chain state |
| 6. Publish | 3 | Publish collection, verify public page |
| 7. Purchase | 3 | Buy NFT from public page |
| 8. Showroom | 3 | Create showroom, invite artist, propose collection |
| 9. Showroom Purchase | 4 | Deploy showroom, publish, buy via showroom |
| 10. Final State | 4 | Verify balances, ownership, payment splits |

---

## Project Structure

```
heritage-splitter/
├── backend/          Rust/Axum API server (80+ endpoints, SQLite, ethers-rs)
├── blockchain/       Solidity contracts + Foundry tests (7 contracts, 94 tests)
├── frontend/         SolidJS + TypeScript + Tailwind CSS
├── e2e/              Playwright end-to-end tests (33 tests, 4 user personas)
├── k8s/              Kubernetes manifests (dev + prod)
├── scripts/          Deployment and utility scripts
├── documentation/    Comprehensive project documentation
├── Tiltfile           Hot-reload dev environment config
└── Makefile           Common dev commands
```

---

## Documentation

Deep-dive into every aspect of the project:

### Product
- **[Product Overview](documentation/product-overview.md)** — What Heritage Splitter does, who it's for, key features
- **[User Journeys](documentation/user-journeys.md)** — Step-by-step flows for artists, producers, and buyers
- **[Personas](documentation/personas.md)** — Target users: Leo the Artist, Gil the Producer

### Architecture
- **[Architecture Overview](documentation/architecture-overview.md)** — System design, component breakdown, on-chain vs off-chain
- **[Smart Contracts](documentation/smart-contracts.md)** — All 7 contracts: purpose, functions, interactions, events
- **[Payment Flows](documentation/payment-flows.md)** — Revenue splitting, showroom margins, royalties, gas costs

### Technical
- **[Technical Stack](documentation/technical-stack.md)** — Every technology choice with rationale
- **[Architecture Decisions](documentation/architecture-decisions.md)** — 10 ADRs with trade-off analysis
- **[API Reference](documentation/api-reference.md)** — REST endpoints, authentication, WebSocket protocol
- **[Database Schema](documentation/database-schema.md)** — All tables, relationships, indexes
- **[Security Model](documentation/security-model.md)** — Auth, encryption, rate limiting, contract safety

### Operations
- **[Deployment Guide](documentation/deployment-guide.md)** — Local dev (Tilt), staging, production
- **[Testing Strategy](documentation/testing-strategy.md)** — Smart contract, backend, and E2E test coverage

---

## Security Highlights

- **Reentrancy protection** on all payment functions (ReentrancyGuard + 2300 gas stipend)
- **Two-step ownership transfer** on all critical contracts (no accidental transfer)
- **EIP-712 typed signatures** for gasless document certification (replay-protected)
- **Push-first, pull-fallback** payments — immediate delivery for EOAs, safe fallback for contract wallets
- **Container hardening** — non-root, read-only filesystem, seccomp, no service account tokens
- **Network policies** — strict ingress/egress rules between services

---

## Network

| | |
|---|---|
| **Blockchain** | Avalanche C-Chain |
| **Testnet** | Fuji (Chain ID: 43113) |
| **Token** | AVAX (18 decimals) |
| **Consensus** | Snowman (sub-second finality) |
| **Avg. tx cost** | ~$0.01 |

---

Built for the [Avalanche Hackathon](https://www.avax.network/) by the Trace team.
