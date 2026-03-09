# Testing Strategy

## Overview

| Layer | Framework | Tests | Coverage |
|-------|-----------|-------|----------|
| Smart Contracts | Foundry (forge) | 94 | Deployment, minting, purchasing, splitting, showroom, documents |
| Backend | Rust (cargo test) | 19 | Showroom API, auth, listings, participants |
| End-to-End | Playwright | 33 | Full user journeys across all features |

## Smart Contract Tests (94 tests)

### Test Suites

| Suite | File | Tests | Coverage |
|-------|------|-------|----------|
| CollectionFactory | `test/CollectionFactory.t.sol` | ~15 | Deploy, registry auth, owner collections |
| CollectionNFT | (integrated) | ~10 | Mint, batch mint, burn, royalty info |
| ArtistsSplitter | (integrated) | ~8 | Payment distribution, rounding, rescue |
| NFTMarket | `test/NFTMarket.t.sol` | ~20 | List, purchase, delist, refunds, access |
| Showroom | `test/Showroom.t.sol` | ~18 | Items, margins, purchase flow, refunds |
| PaymentRegistry | `test/PaymentRegistry.t.sol` | ~15 | Push/pull, deferred, withdraw, upgrade |
| DocumentRegistry | (integrated) | ~8 | Certify, certifyFor, EIP-712, nonces |

### Testing Patterns
- **Setup**: Each test suite deploys fresh contracts in `setUp()`
- **Pranking**: `vm.prank(address)` to simulate different callers
- **Assertions**: `assertEq`, `vm.expectRevert`, `vm.expectEmit`
- **Edge cases**: Zero values, max arrays (100 items), reentrancy attempts, unauthorized access

### Running
```bash
cd blockchain
forge test                    # Run all
forge test -vvv               # With stack traces
forge test --match-test testPurchase  # Single test
forge test --gas-report       # Gas analysis
```

## Backend Tests (19 tests)

### Test Suite: `tests/showroom_api.rs`

Integration tests that spin up a real Axum server with an in-memory SQLite database.

| Test | What it verifies |
|------|-----------------|
| `test_create_showroom` | POST /api/showrooms creates a showroom |
| `test_list_showrooms_empty` | GET /api/showrooms returns empty list |
| `test_list_showrooms_with_data` | GET /api/showrooms returns showrooms |
| `test_get_showroom_detail` | GET /api/showrooms/{id} returns full detail |
| `test_get_showroom_not_found` | 404 on nonexistent showroom |
| `test_update_showroom` | PUT /api/showrooms/{id} updates fields |
| `test_update_showroom_forbidden_for_non_owner` | 403 for non-owner |
| `test_invite_user_to_showroom` | POST /api/showrooms/{id}/invite works |
| `test_invite_nonexistent_user` | 404 on invalid user |
| `test_accept_showroom_invite` | POST /api/showrooms/{id}/accept works |
| `test_accept_without_invitation` | 400 without prior invite |
| `test_create_listing` | POST /api/showrooms/{id}/listings works |
| `test_create_listing_by_accepted_participant` | Participant can create listing |
| `test_create_listing_forbidden_for_uninvited` | 403 for non-member |
| `test_update_listing_set_margin` | PUT /api/showroom-listings/{id} updates margin |
| `test_delete_listing` | DELETE /api/showroom-listings/{id} works |
| `test_delete_listing_forbidden_for_non_owner_non_proposer` | 403 for unauthorized |
| `test_showroom_detail_includes_participants_and_listings` | Detail includes nested data |
| `test_showroom_endpoints_require_auth` | 401 without token |

### Running
```bash
cd backend
cargo test                          # All tests
cargo test test_create_showroom     # Single test
cargo test -- --nocapture           # With println output
```

## End-to-End Tests (33 tests)

### Framework: Playwright

Real browser tests that navigate the frontend, fill forms, click buttons, and verify outcomes. Tests run against a live backend with Anvil (local Ethereum node).

### Test Structure

Single file: `e2e/playwright/tests/full-story.spec.ts`

10 chapters executed sequentially (each builds on previous state):

| Chapter | Tests | Description |
|---------|-------|-------------|
| 1. Project Creation | 3 | Create project, verify dashboard |
| 2. Collection Setup | 3 | Create collection, add draft NFTs |
| 3. Allocations | 3 | Define allocation categories, assign participants |
| 4. Approval & Deploy | 4 | Submit, approve, deploy on-chain |
| 5. Verify Mint | 3 | Check minted NFTs, on-chain state |
| 6. Publish | 3 | Publish collection, verify public page |
| 7. Purchase | 3 | Buy NFT from public page |
| 8. Showroom | 3 | Create showroom, invite artist, propose collection |
| 9. Showroom Purchase | 4 | Deploy showroom, publish, buy via showroom |
| 10. Final State | 4 | Verify all balances, ownership, splits |

### Test Users (4 personas)
- **Alice**: Lead artist, project creator
- **Bob**: Collaborating artist
- **Charlie**: Producer (showroom owner)
- **Dave**: Collector (buyer)

### Key Patterns
- `globalSetup`: Starts backend, Anvil, deploys contracts, creates 4 authenticated users
- `page.addInitScript()`: Injects JWT tokens into localStorage before SolidJS loads
- Sequential execution: Each test depends on previous state (deployment, minting, etc.)
- On-chain verification: Tests read contract state via ethers to verify NFT ownership, payment splits

### Running
```bash
cd e2e/playwright
npx playwright test              # Run all
npx playwright test --ui         # Interactive mode
npx playwright test --headed     # Show browser
npx playwright test -g "deploy"  # Filter by name
```

### Environment
- Backend must be built (`cargo build`) before running
- Anvil runs on port 8545
- Frontend served on port 8080
- `PRIVATE_KEY` env var must keep `0x` prefix
