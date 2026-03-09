# E2E Test Suite

End-to-end tests for Heritage Splitter using Playwright, Anvil, and Tilt.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Tilt (tilt up -f Tiltfile.e2e)                             │
│                                                              │
│  K8s Pods:                                                   │
│    ┌─────────┐    ┌─────────────┐    ┌──────────┐           │
│    │  Anvil  │───▶│   Backend   │───▶│ Frontend │           │
│    │  :18545 │    │   :13001    │    │  :8877   │           │
│    └─────────┘    └─────────────┘    └──────────┘           │
│         ▲                ▲                                   │
│  Local:                                                      │
│    ┌──────────────────┐                                      │
│    │ deploy-contracts │  forge script → kubectl set env      │
│    └──────────────────┘                                      │
│         │                                                    │
│    ┌──────────────────┐                                      │
│    │   Playwright     │  globalSetup → tests → teardown      │
│    │   (local browser │  MetaMask extension automation       │
│    │    + MetaMask)   │                                      │
│    └──────────────────┘                                      │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

- **Tilt** + **kubectl** + **Docker** (for Tilt mode)
- **Node.js** 20+ with `npx playwright install chromium`
- **Foundry** (`forge`, `cast`, `anvil`)
- **Rust** backend binary: `cd backend && cargo build`
- MetaMask extension in `e2e/playwright/.cache-metamask/metamask-chrome-13.13.1/`

## Quick Start

### Option 1: Tilt mode (recommended)

```bash
# Start all services in K8s
tilt up -f Tiltfile.e2e

# Wait for all services to be green in the Tilt dashboard
# Then trigger tests from the dashboard, or:
cd e2e/playwright && \
  E2E_ANVIL_RPC=http://localhost:18545 \
  E2E_API_URL=http://localhost:13001/api \
  E2E_FRONTEND_URL=http://localhost:8877 \
  npx playwright test
```

### Option 2: Standalone mode (no Tilt/K8s needed)

```bash
cd e2e/playwright && npx playwright test
```

GlobalSetup automatically starts Anvil + backend + frontend on random ports.

## How It Works

1. **Tilt** starts Anvil (local blockchain), Backend (Rust/Axum), and Frontend (SolidJS/Caddy) in K8s
2. **`deploy-contracts.sh`** deploys smart contracts on Anvil and patches the backend K8s env with contract addresses
3. Playwright **`globalSetup`** creates all test data:
   - Authenticates 4 personas (Alice, Bob, Charlie, Dave)
   - Creates project, invites participants
   - Uploads and certifies a document (EIP-712 meta-tx)
   - Creates collection with multi-round NFT minting (3 rounds, 1 NFT each)
   - Publishes collection for public sale
   - Charlie buys NFT #0 directly on-chain
   - Dave creates showroom via API, deploys and publishes it
   - Charlie buys NFT #1 via showroom
   - Snapshots balances for payment verification
4. **Tests** run locally with a real browser + MetaMask extension

## Test Structure (8 Chapters)

| Chapter | What it tests |
|---------|--------------|
| 1. Collaboration & Project | Project exists with 2 accepted participants |
| 2. Document Certification | Document shared with Bob, certified on-chain (EIP-712) |
| 3. Multi-Round Mint | 3 NFTs minted across 3 approval rounds, market listings correct |
| 4. Public Sale Page | Browser: collection name, Buy buttons, Sold badge |
| 5. MetaMask Purchase | Browser: buy NFT via MetaMask (connect + network + tx popups) |
| 6. Showroom | On-chain: owner, registry, items with margins, NFT ownership |
| 7. Payment Verification | Balance deltas: artist shares (70/30), showroom margins |
| 8. Final State | Charlie's NFT count, market remaining, unpublish hides collection |

## How to Modify Tests

### Add data to globalSetup

Edit `helpers/global-setup.ts` to add new setup steps. The config object written at the end is available in all tests via `cfg`.

### Add a new chapter

Add a new `test.describe("Chapter N: ...")` block in `tests/full-story.spec.ts`. Tests run sequentially within the file.

### Update contract ABIs

Edit `helpers/contracts.ts` to match the Solidity contracts in `blockchain/src/`.

## MetaMask Helper

`helpers/metamask.ts` provides pure Playwright automation for MetaMask:

- **`launchBrowserWithMetaMask(baseURL)`** — Launches Chromium with the MetaMask extension, completes onboarding (import seed phrase, create password, dismiss popovers)
- **`connectToDapp()`** — Approves the "Connect to dApp" notification popup
- **`approveNewNetwork()`** — Approves "Add network" popup
- **`approveSwitchNetwork()`** — Approves "Switch network" popup
- **`confirmTransaction()`** — Confirms a transaction in the notification popup

No Synpress dependency — everything is done via Playwright's persistent context and extension APIs.

## Contract Deployment

In **Tilt mode**, `deploy-contracts.sh` runs `forge script Deploy.s.sol` which deploys:

- **CollectionFactory** — Creates NFT collections with splitter contracts
- **NFTMarket** — Multi-collection marketplace
- **DocumentRegistry** — Document hash certification (EIP-712 meta-tx)
- **PaymentRegistry** — Behind TransparentUpgradeableProxy, push-first payment distribution

In **standalone mode**, `globalSetup` calls `forge script` directly.

## 4 Personas

| # | Name | Key | Role |
|---|------|-----|------|
| 0 | Alice | `0xac09...` | Artist, project creator |
| 1 | Bob | `0x59c6...` | Artist, collaborator |
| 2 | Charlie | `0x5de4...` | Buyer/collector |
| 3 | Dave | `0x7c85...` | Producer, showroom owner |

All use Anvil's deterministic accounts (from seed phrase `test test test ... junk`).

## File Structure

```
e2e/
├── deploy-contracts.sh          # Deploys contracts on Anvil (used by Tilt)
├── README.md                    # This file
├── playwright/
│   ├── package.json             # Playwright + viem deps
│   ├── playwright.config.ts     # Config: globalSetup, timeout, baseURL
│   ├── helpers/
│   │   ├── contracts.ts         # Contract ABIs (Factory, NFT, Market, Showroom, DocRegistry, PaymentRegistry)
│   │   ├── infra.ts             # Start Anvil + backend + frontend (standalone mode)
│   │   ├── global-setup.ts      # Full pipeline: auth → project → docs → collection → mint → showroom → purchases
│   │   ├── global-teardown.ts   # Cleanup (standalone: kill processes; Tilt: noop)
│   │   └── metamask.ts          # MetaMask extension automation (pure Playwright)
│   └── tests/
│       └── full-story.spec.ts   # 8 chapters covering complete journey
├── helpers/                     # Node.js native test helpers (legacy)
│   ├── infra.mjs
│   ├── metamask.mjs
│   └── contracts.mjs
└── tests/                       # Node.js native tests (legacy)
    ├── helpers.mjs
    ├── browser-e2e.test.mjs
    ├── full-flow.test.mjs
    ├── purchase-flow.test.mjs
    └── showroom-flow.test.mjs
```

## Links

- [Tilt](https://docs.tilt.dev/) — local K8s orchestration
- [Anvil](https://book.getfoundry.sh/reference/anvil/) — local Ethereum node
- [Playwright](https://playwright.dev/docs/intro) — browser automation
- [Foundry](https://book.getfoundry.sh/) — Solidity development toolkit
