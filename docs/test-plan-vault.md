# Test Plan: HeritageVault + Refactored Contracts

**Scope:** Vault-based primary sales, simplified HeritageNFT (no marketplace), updated HeritageSplitter (distribute primary among all beneficiaries), updated HeritageFactory (deploys trio), backend deploy-to-vault, public sale page.

**Reference contracts:**
- `blockchain/src/HeritageVault.sol`
- `blockchain/src/HeritageNFT.sol` (post-refactor: ERC721Enumerable, no marketplace)
- `blockchain/src/HeritageSplitter.sol` (post-refactor: releasePrimary splits among beneficiaries)
- `blockchain/src/HeritageFactory.sol` (post-refactor: deploys NFT + Splitter + Vault trio)

---

## 1. Smart Contract Tests (Foundry)

All Foundry tests live in `blockchain/test/`. Run with `forge test -vvv`.

### 1.1 HeritageNFT (post-refactor)

File: `blockchain/test/HeritageNFT.t.sol`

| ID | Test | Description | Expected |
|----|------|-------------|----------|
| NFT-01 | `test_constructor` | Name, symbol, splitter, owner, contractURI set correctly | All getters return constructor params |
| NFT-02 | `test_supportsInterface_ERC721Enumerable` | `supportsInterface(0x780e9d63)` returns true | ERC721Enumerable ID recognized |
| NFT-03 | `test_supportsInterface_ERC2981` | `supportsInterface(0x2a55205a)` returns true | ERC-2981 recognized |
| NFT-04 | `test_supportsInterface_ERC721` | `supportsInterface(0x80ac58cd)` returns true | Core ERC-721 recognized |
| NFT-05 | `test_mint_singleToken` | Owner mints token 0 to address | ownerOf(0) == recipient, tokenURI correct, totalSupply == 1 |
| NFT-06 | `test_mint_onlyOwner` | Non-owner calls mint | Reverts with OwnableUnauthorizedAccount |
| NFT-07 | `test_mintBatch` | Mint 5 tokens at once | All ownerOf correct, totalSupply == 5 |
| NFT-08 | `test_mintBatch_emptyArray` | Mint with empty URIs array | Returns empty array, totalSupply unchanged |
| NFT-09 | `test_transferFrom_allowed` | Owner transfers token freely | Transfer succeeds, ownerOf updates |
| NFT-10 | `test_safeTransferFrom_allowed` | Owner safeTransfers token | Transfer succeeds, receiver gets token |
| NFT-11 | `test_approve_and_transferFrom` | Approve spender, spender transfers | Transfer succeeds |
| NFT-12 | `test_setApprovalForAll_and_transfer` | setApprovalForAll, operator transfers | Transfer succeeds |
| NFT-13 | `test_enumerable_tokenOfOwnerByIndex` | Mint 3 to same address, query by index | Returns correct token IDs |
| NFT-14 | `test_enumerable_tokenByIndex` | Mint 3, query global index | Returns tokens 0,1,2 |
| NFT-15 | `test_enumerable_afterTransfer` | Mint to A, transfer to B, enumerate B | B has 1, A has 0 |
| NFT-16 | `test_royaltyInfo` | Query royaltyInfo(0, 10000) | Returns (splitter, 1000) for 10% royalty |
| NFT-17 | `test_contractURI` | Query contractURI | Returns constructor string |
| NFT-18 | `test_marketplace_removed` | Verify no listForSale/buy/cancelListing selectors | Contract has no marketplace functions |

### 1.2 HeritageVault

File: `blockchain/test/HeritageVault.t.sol`

**Setup:** Deploy Splitter, NFT (Enumerable), Vault. Mint tokens to vault. Set prices.

| ID | Test | Description | Expected |
|----|------|-------------|----------|
| VLT-01 | `test_constructor` | nftContract, splitter, producer set | Getters return constructor args |
| VLT-02 | `test_setPrice` | Producer sets price for token 0 | tokenPrice(0) == set value, PriceSet event emitted |
| VLT-03 | `test_setPrice_onlyProducer` | Non-producer calls setPrice | Reverts OnlyProducer |
| VLT-04 | `test_setPrice_zeroPrice` | Producer sets price = 0 | Reverts PriceCannotBeZero |
| VLT-05 | `test_setPriceBatch` | Set prices for 5 tokens in one call | All tokenPrice values correct |
| VLT-06 | `test_setPriceBatch_lengthMismatch` | Arrays of different lengths | Reverts "Length mismatch" |
| VLT-07 | `test_setPriceBatch_oneZeroPrice` | Batch with one zero price | Reverts PriceCannotBeZero (no partial writes) |
| VLT-08 | `test_purchase_success` | Buyer sends exact price | NFT transferred to buyer, splitter receives funds, NFTPurchased event |
| VLT-09 | `test_purchase_notInVault` | Token not in vault (already sold or never minted there) | Reverts NotInVault |
| VLT-10 | `test_purchase_priceNotSet` | Token in vault but price == 0 | Reverts PriceNotSet |
| VLT-11 | `test_purchase_insufficientPayment` | msg.value < price | Reverts InsufficientPayment |
| VLT-12 | `test_purchase_overpayment_refund` | msg.value > price | NFT transferred, excess refunded to buyer |
| VLT-13 | `test_purchase_splitterReceivesPrimary` | After purchase, check splitter primaryBalances | primaryBalances[tokenId] == price |
| VLT-14 | `test_purchase_tokenPhaseStillPrimary` | After purchase (before release) | tokenPhase[tokenId] == PRIMARY |
| VLT-15 | `test_purchase_multipleDifferentPrices` | Set different prices per token, buy each | Each purchase at correct price, each splitter balance correct |
| VLT-16 | `test_purchase_sameBuyerTwice` | Buyer purchases two different tokens | Both transfers succeed |
| VLT-17 | `test_listAvailableTokens_initial` | After minting 3 to vault | Returns 3 token IDs with their prices |
| VLT-18 | `test_listAvailableTokens_afterPurchase` | Mint 3, buy 1 | Returns 2 remaining tokens |
| VLT-19 | `test_availableCount` | Mint 5, buy 2 | Returns 3 |
| VLT-20 | `test_onERC721Received` | Vault receives NFT via safeTransferFrom | Returns correct selector, token held |
| VLT-21 | `test_purchase_reEntrancy` | Malicious buyer tries re-entrancy on purchase | Reverts (ReentrancyGuard) |
| VLT-22 | `testFuzz_purchase_anyValidPrice` | Fuzz price [1 wei .. 100 ether] | splitter.primaryBalances == price, buyer owns NFT |

### 1.3 HeritageSplitter (post-refactor: primary distributes to all)

File: `blockchain/test/HeritageSplitter.t.sol`

| ID | Test | Description | Expected |
|----|------|-------------|----------|
| SPL-01 | `test_constructor` | Producer, royaltyBps, totalShares, beneficiaryCount | All correct |
| SPL-02 | `test_constructor_invalidShares` | Shares sum != 10000 | Reverts InvalidShares |
| SPL-03 | `test_constructor_zeroAddress` | Zero address in wallets | Reverts NoZeroAddress |
| SPL-04 | `test_constructor_lengthMismatch` | wallets.length != roles.length | Reverts "Length mismatch" |
| SPL-05 | `test_constructor_royaltyOver100` | royaltyBps = 10001 | Reverts "Royalty > 100%" |
| SPL-06 | `test_receivePrimary` | Send 1 ether for token 0 | primaryBalances[0] == 1 ether, PrimaryReceived event |
| SPL-07 | `test_receivePrimary_zeroValue` | Send 0 value | Reverts "No value" |
| SPL-08 | `test_receivePrimary_notPrimary` | Token already SECONDARY | Reverts "Not primary" |
| SPL-09 | `test_releasePrimary_distributesAmongBeneficiaries` | 3 beneficiaries (50/35/15), release 10 ether | pendingWithdrawals: 5 + 3.5 + 1.5 ether |
| SPL-10 | `test_releasePrimary_onlyProducer` | Non-producer calls | Reverts OnlyProducer |
| SPL-11 | `test_releasePrimary_alreadySecondary` | Release same token twice | Reverts TokenAlreadySecondary |
| SPL-12 | `test_releasePrimary_noPrimaryBalance` | Token never received funds | Reverts NoPrimaryBalance |
| SPL-13 | `test_releasePrimary_phaseChanges` | After release | tokenPhase[tokenId] == SECONDARY, PhaseChanged event |
| SPL-14 | `test_releasePrimary_thenWithdraw` | Release, each beneficiary withdraws | Each receives correct share, balances zeroed |
| SPL-15 | `test_receiveSecondary_distributes` | Token in SECONDARY, send royalty | Pending withdrawals match share proportions |
| SPL-16 | `test_receiveSecondary_notSecondary` | Token still PRIMARY | Reverts "Not secondary" |
| SPL-17 | `test_withdraw` | Beneficiary with pending balance withdraws | Balance transferred, pending zeroed |
| SPL-18 | `test_withdraw_nothingToWithdraw` | No pending balance | Reverts NothingToWithdraw |
| SPL-19 | `test_withdraw_accumulatesAcrossTokens` | Royalties from tokens 0, 1, 2 accumulate | Single withdraw gets total |
| SPL-20 | `test_royaltyInfo` | Query royaltyInfo(0, salePrice) | Returns (address(this), salePrice * bps / 10000) |
| SPL-21 | `test_getBeneficiaries` | Query all beneficiaries | Returns correct wallets, roles, shares |
| SPL-22 | `testFuzz_releasePrimary_distribution` | Fuzz amount [1 .. 100 ether] | Sum of pending withdrawals == amount |
| SPL-23 | `testFuzz_secondaryDistribution` | Fuzz amount [1 .. 100 ether] | Sum of pending withdrawals == amount |
| SPL-24 | `test_releasePrimary_dustHandling` | Amount that causes rounding (e.g. 1 wei with 3 beneficiaries) | Last beneficiary receives remainder, total == input |
| SPL-25 | `test_receiveSecondary_dustHandling` | Same rounding edge case for secondary | Last beneficiary absorbs dust |

### 1.4 HeritageFactory (post-refactor: deploys trio)

File: `blockchain/test/HeritageFactory.t.sol`

| ID | Test | Description | Expected |
|----|------|-------------|----------|
| FAC-01 | `test_createHeritage_returnsTrio` | createHeritage returns (index, nftAddr, splitterAddr, vaultAddr) | All three addresses non-zero |
| FAC-02 | `test_createHeritage_nftConfig` | Verify deployed NFT | name, symbol, owner == producer, splitter set |
| FAC-03 | `test_createHeritage_splitterConfig` | Verify deployed Splitter | producer, royaltyBps, beneficiaries correct |
| FAC-04 | `test_createHeritage_vaultConfig` | Verify deployed Vault | nftContract, splitter, producer correct |
| FAC-05 | `test_createHeritage_heritageStored` | Check heritages[0] struct | nft, splitter, vault, producer, createdAt set |
| FAC-06 | `test_createHeritage_emitsEvent` | HeritageCreated event | Contains index, all 3 addresses, producer, name, symbol |
| FAC-07 | `test_heritageCount` | Deploy 0, 1, 3 | Returns correct count each time |
| FAC-08 | `test_producerHeritages` | Same producer deploys twice | getProducerHeritages returns [0, 1] |
| FAC-09 | `test_differentProducers` | Two different producers | Each has own index list |

### 1.5 End-to-End Integration (Foundry)

File: `blockchain/test/HeritageE2E.t.sol`

| ID | Test | Description | Expected |
|----|------|-------------|----------|
| E2E-01 | `test_fullFlow_factoryToSale` | Factory deploys trio, producer mints to vault, sets prices, buyer purchases, producer releases, beneficiaries withdraw | Each step succeeds, final balances correct |
| E2E-02 | `test_fullFlow_primaryThenSecondary` | After vault purchase + release, buyer lists on OpenSea-style marketplace (simulate transfer + royalty payment to splitter) | Secondary royalties distributed correctly |
| E2E-03 | `test_fullFlow_batchMintToVault` | Mint batch of 10 tokens directly to vault, set prices, purchase 3 | Vault holds 7, splitter has 3 tokens' worth |
| E2E-04 | `test_fullFlow_multipleTokensPurchaseAndRelease` | Buy tokens 0,1,2 at different prices, release each | Each beneficiary's pending withdrawal is sum across all tokens |
| E2E-05 | `test_fullFlow_secondaryRoyaltySplit` | After primary cycle completes, simulate secondary sale royalty | receiveSecondary distributes among beneficiaries |

---

## 2. API Tests (curl / httpie)

Base URL: `http://localhost:3001/api`

All authenticated routes require `Authorization: Bearer <jwt>`.

### 2.1 Deploy Work (existing route, modified)

| ID | Method | Endpoint | Body | Expected |
|----|--------|----------|------|----------|
| API-01 | POST | `/works/{id}/deploy` | (none) | 200, status -> "deployed", `contract_nft_address`, `contract_splitter_address`, `contract_vault_address` all populated |
| API-02 | POST | `/works/{id}/deploy` | Work not in `ready_to_deploy` status | 400 "Work must be validated before deployment" |
| API-03 | POST | `/works/{id}/deploy` | Allocation with no participants | 400 "needs at least one participant" |
| API-04 | POST | `/works/{id}/deploy` | Allocation with pending participant | 400 "not all participants accepted" |
| API-05 | POST | `/works/{id}/deploy` | Custom allocation with wrong shares sum | 400 "shares sum != total_bps" |
| API-06 | GET | `/works/{id}` | After deploy | Response includes `contract_vault_address` field |

**Verification curl:**
```bash
# Deploy work
curl -X POST http://localhost:3001/api/works/$WORK_ID/deploy \
  -H "Authorization: Bearer $TOKEN"

# Verify all three addresses present
curl http://localhost:3001/api/works/$WORK_ID \
  -H "Authorization: Bearer $TOKEN" | jq '{
    nft: .contract_nft_address,
    splitter: .contract_splitter_address,
    vault: .contract_vault_address
  }'
```

### 2.2 Publish Work (new route)

| ID | Method | Endpoint | Body | Expected |
|----|--------|----------|------|----------|
| API-07 | POST | `/works/{id}/publish` | (none) | 200, work status -> "published", slug generated |
| API-08 | POST | `/works/{id}/publish` | Work not deployed | 400 "Work must be deployed" |
| API-09 | POST | `/works/{id}/publish` | Non-creator calls | 403 Forbidden |
| API-10 | POST | `/works/{id}/publish` | Custom slug body `{"slug": "my-art"}` | 200, slug == "my-art" |
| API-11 | POST | `/works/{id}/publish` | Duplicate slug | 409 Conflict |

### 2.3 Public Sale API (new routes, no auth)

| ID | Method | Endpoint | Body | Expected |
|----|--------|----------|------|----------|
| API-12 | GET | `/public/sale/{slug}` | - | 200, returns work metadata, NFT list with prices, contract addresses |
| API-13 | GET | `/public/sale/{slug}` | Non-existent slug | 404 |
| API-14 | GET | `/public/sale/{slug}` | Unpublished work | 404 |
| API-15 | GET | `/public/sale/{slug}/nfts` | - | 200, array of NFTs with tokenId, title, image_url, price, available (vault check) |
| API-16 | GET | `/public/sale/{slug}/nfts` | All NFTs sold out | 200, empty array or all marked available: false |

**Verification curl:**
```bash
# Public sale page data
curl http://localhost:3001/api/public/sale/$SLUG | jq

# NFT listing
curl http://localhost:3001/api/public/sale/$SLUG/nfts | jq '.[0]'
```

### 2.4 Deploy Mints to Vault

| ID | Method | Endpoint | Scenario | Expected |
|----|--------|----------|----------|----------|
| API-17 | POST | `/works/{id}/deploy` | Work has 3 draft NFTs | All 3 minted to vault address (not to producer), nfts table has `owner_address == vault_address` |
| API-18 | POST | `/works/{id}/mint` | Post-deploy mint cycle: add drafts, approve, mint | New NFTs also minted to vault |
| API-19 | GET | `/works/{id}` | After deploy | nfts[].owner_address == vault contract address |

---

## 3. Frontend Tests (Playwright)

### 3.1 WorkOverview: Integration Section

| ID | Test | Steps | Expected |
|----|------|-------|----------|
| FE-01 | Vault address displayed | Deploy work, navigate to WorkOverview | Shows NFT, Splitter, AND Vault contract addresses |
| FE-02 | Contract addresses copy button | Click copy icon next to address | Address copied to clipboard |
| FE-03 | Vault address links to explorer | Click vault address | Opens Snowtrace/explorer in new tab |
| FE-04 | Addresses hidden pre-deploy | Navigate to draft work overview | No "Contrats deployes" section visible |

### 3.2 WorkOverview: Publish Button

| ID | Test | Steps | Expected |
|----|------|-------|----------|
| FE-05 | Publish button visible when deployed | Work in `deployed` status, user is creator | "Publier la vente" button visible |
| FE-06 | Publish button hidden for non-creator | Logged in as participant | Button not visible |
| FE-07 | Publish button hidden pre-deploy | Work in `draft` status | Button not visible |
| FE-08 | Publish confirmation modal | Click publish button | Modal asks for confirmation, shows slug preview |
| FE-09 | Publish success | Confirm publish | Success toast, status updates, sale link displayed |
| FE-10 | Custom slug input | Edit slug before confirming | Published with custom slug |

### 3.3 Public Sale Page `/sale/{slug}`

| ID | Test | Steps | Expected |
|----|------|-------|----------|
| FE-11 | Page loads without auth | Navigate to `/sale/{slug}` in incognito | Page renders, no login required |
| FE-12 | Work metadata displayed | Load sale page | Title, description, creator name, royalty info shown |
| FE-13 | NFT grid renders | Load sale page with NFTs | Grid of NFT cards with image, title, price |
| FE-14 | NFT price display | Check NFT card | Price shown in AVAX with fiat estimate |
| FE-15 | Connect wallet button | No wallet connected | "Connecter le wallet" button visible |
| FE-16 | Purchase flow: connect wallet | Click connect | Wallet modal appears (MetaMask / WalletConnect) |
| FE-17 | Purchase flow: buy NFT | Click "Acheter" on NFT card, confirm tx | Transaction sent, toast shows pending, then success |
| FE-18 | Purchase flow: NFT sold out | All vault tokens purchased | Card shows "Vendu" badge, buy button disabled |
| FE-19 | Purchase flow: insufficient balance | Wallet balance < price | Error message, transaction not sent |
| FE-20 | Purchase flow: wrong network | Connected to wrong chain | Prompt to switch to Avalanche C-Chain |
| FE-21 | Page not found | Navigate to `/sale/nonexistent` | 404 page displayed |
| FE-22 | Responsive layout | Resize to mobile viewport | Grid collapses, buttons still usable |

### 3.4 Viem Documentation Section

| ID | Test | Steps | Expected |
|----|------|-------|----------|
| FE-23 | Integration tab visible | Navigate to deployed work | "Integration" tab/section in WorkOverview |
| FE-24 | Code snippets displayed | Open integration section | Shows viem code for reading vault, purchasing NFT |
| FE-25 | Copy code button | Click copy on code snippet | Code copied to clipboard |
| FE-26 | ABI download | Click "Telecharger ABI" | Downloads JSON ABI for HeritageVault |

---

## 4. Edge Cases & Security

### 4.1 Smart Contract Security

| ID | Category | Scenario | Expected |
|----|----------|----------|----------|
| SEC-01 | Reentrancy | Malicious contract calls purchase() with re-entrant onERC721Received | Reverts (ReentrancyGuard) |
| SEC-02 | Reentrancy | Malicious contract calls splitter.withdraw() re-entrantly | Reverts (ReentrancyGuard) |
| SEC-03 | Reentrancy | Malicious contract calls releasePrimary then re-enters via fallback | Reverts (ReentrancyGuard) |
| SEC-04 | Access control | Random address calls vault.setPrice | Reverts OnlyProducer |
| SEC-05 | Access control | Random address calls vault.setPriceBatch | Reverts OnlyProducer |
| SEC-06 | Access control | Random address calls splitter.releasePrimary | Reverts OnlyProducer |
| SEC-07 | Access control | Random address calls nft.mint | Reverts OwnableUnauthorizedAccount |
| SEC-08 | Double spend | Buy same token twice in same block | First succeeds, second reverts NotInVault |
| SEC-09 | Front-running | Price change between user's view and tx | User pays old price if tx mined before setPrice, or new price applies |
| SEC-10 | Overflow | tokenPrice set to type(uint256).max, buyer sends same | No overflow in splitter (Solidity 0.8 checked math) |
| SEC-11 | Zero-value | purchase() with msg.value == 0 | Reverts InsufficientPayment (price > 0 enforced by setPrice) |
| SEC-12 | Dust rounding | 1 wei split among 3 beneficiaries | Last beneficiary gets remainder, no funds stuck |
| SEC-13 | Token theft | Vault receives token not from NFT contract, tries to sell | tokenPrice not set, reverts PriceNotSet |
| SEC-14 | Vault drain | Attacker tries to withdraw ETH from vault | No withdraw function exists on vault; funds go straight to splitter |
| SEC-15 | Self-purchase | Producer buys own NFT from vault | Allowed (no business reason to block), funds cycle through splitter |

### 4.2 State Machine Edge Cases

| ID | Scenario | Expected |
|----|----------|----------|
| EDGE-01 | Deploy with 0 draft NFTs | Deploy succeeds but vault is empty, no tokens to sell |
| EDGE-02 | Deploy with 1 NFT, price never set | Token in vault but purchase reverts PriceNotSet until setPrice called |
| EDGE-03 | Mint to vault after initial deploy (post-deploy mint cycle) | New tokens appear in vault, need setPrice before purchasable |
| EDGE-04 | releasePrimary before any purchase | Reverts NoPrimaryBalance |
| EDGE-05 | releasePrimary for token not yet purchased | Reverts NoPrimaryBalance (primaryBalances == 0) |
| EDGE-06 | Multiple receivePrimary for same token (partial payments) | primaryBalances accumulates (unlikely in vault model, but safe) |
| EDGE-07 | Beneficiary is also the producer | Receives both primary share and can call releasePrimary |
| EDGE-08 | Single beneficiary with 10000 bps | Gets 100% of everything, no dust issues |
| EDGE-09 | Very large number of beneficiaries (e.g. 50) | Gas cost increases linearly, but should remain under block limit |
| EDGE-10 | Vault receives non-Heritage NFT via safeTransferFrom | onERC721Received accepts it, but it cannot be sold (price mapping is per-tokenId, nftContract check in purchase reverts) |

### 4.3 Backend Edge Cases

| ID | Scenario | Expected |
|----|----------|----------|
| BE-01 | Deploy fails mid-transaction (contract deployment reverts) | DB not updated, work stays `ready_to_deploy`, error returned |
| BE-02 | Deploy succeeds but DB update fails | Retry mechanism or manual reconciliation path |
| BE-03 | Publish same work twice | Idempotent (returns existing slug) or 409 if already published |
| BE-04 | Concurrent deploy requests for same work | Only one succeeds, other gets 409 or stale status error |
| BE-05 | NFT with no image_url | Public API returns null/empty, frontend shows placeholder |
| BE-06 | Price stored as string vs integer | Ensure consistent handling (wei as string for big numbers) |

### 4.4 Frontend Edge Cases

| ID | Scenario | Expected |
|----|----------|----------|
| UI-01 | Wallet disconnects mid-purchase | Transaction fails, user sees error, can retry |
| UI-02 | Transaction reverts after user confirms in wallet | Error toast with revert reason |
| UI-03 | Slow RPC: vault.listAvailableTokens times out | Loading spinner, retry button |
| UI-04 | NFT image fails to load | Fallback placeholder image |
| UI-05 | Price displayed while chain data loading | Skeleton loader or "..." until resolved |
| UI-06 | User navigates away during pending tx | Toast persists, tx status tracked in background |

---

## 5. Acceptance Criteria

### 5.1 Smart Contracts

- [ ] HeritageNFT has NO marketplace functions (no listForSale, buy, cancelListing, getListing)
- [ ] HeritageNFT inherits ERC721Enumerable (tokenOfOwnerByIndex, tokenByIndex, totalSupply)
- [ ] HeritageNFT allows free transfers (no _update override blocking transfers)
- [ ] HeritageNFT retains ERC-2981 royalty info pointing to splitter
- [ ] HeritageVault holds NFTs via IERC721Receiver
- [ ] HeritageVault.purchase() sends 100% of price to splitter via receivePrimary
- [ ] HeritageVault.purchase() transfers NFT to buyer via safeTransferFrom
- [ ] HeritageVault.purchase() refunds overpayment
- [ ] HeritageVault.listAvailableTokens() returns all vault-held tokens with prices
- [ ] HeritageSplitter.releasePrimary() distributes among ALL beneficiaries (not just producer)
- [ ] HeritageSplitter.releasePrimary() uses pull pattern (pendingWithdrawals) not direct transfer
- [ ] HeritageSplitter dust handling: last beneficiary gets remainder
- [ ] HeritageFactory.createHeritage() deploys all three contracts (NFT, Splitter, Vault)
- [ ] HeritageFactory returns vault address in Heritage struct and event
- [ ] All existing Foundry tests updated and passing
- [ ] New vault tests passing with 100% function coverage

### 5.2 Backend

- [ ] `deploy_work` mints NFTs to vault address (not producer)
- [ ] `deploy_work` stores `contract_vault_address` in works table
- [ ] DB migration adds `contract_vault_address` column to works table
- [ ] DB migration adds `slug` and `published_at` columns to works table
- [ ] `publish` route sets slug, published_at, status -> "published"
- [ ] Public API `/public/sale/{slug}` returns work + NFTs without auth
- [ ] Public API returns vault address for frontend contract interaction

### 5.3 Frontend

- [ ] WorkOverview shows vault address alongside NFT and splitter addresses
- [ ] Integration section shows viem code examples for vault interaction
- [ ] Public sale page at `/sale/{slug}` loads without authentication
- [ ] Sale page displays NFT grid with images, titles, prices
- [ ] Wallet connection flow (connect, switch network if needed)
- [ ] Purchase transaction: confirm in wallet, pending state, success/error feedback
- [ ] Sold-out NFTs marked as unavailable
- [ ] Responsive design: mobile and desktop

### 5.4 Gas Benchmarks (informational)

Run `forge test --gas-report` and verify:

| Operation | Target Max Gas |
|-----------|---------------|
| HeritageFactory.createHeritage (3 contracts) | < 5,000,000 |
| HeritageVault.purchase (single NFT) | < 200,000 |
| HeritageSplitter.releasePrimary (3 beneficiaries) | < 150,000 |
| HeritageSplitter.withdraw | < 50,000 |
| HeritageNFT.mintBatch (10 tokens) | < 1,500,000 |
| HeritageVault.setPriceBatch (10 tokens) | < 200,000 |

---

## 6. Test Execution Order

1. **Smart contracts first** -- `forge test -vvv` in `blockchain/`
2. **Deploy to local Anvil** -- `anvil` + deploy script, verify addresses
3. **Backend API tests** -- curl against local backend with Anvil RPC
4. **Frontend smoke** -- Playwright against local dev with Anvil
5. **Full E2E** -- Factory deploy -> mint -> set price -> purchase -> release -> withdraw, all via frontend

---

## 7. Regression Checklist

These existing tests must continue to pass after refactoring:

- [ ] `blockchain/test/DocumentRegistry.t.sol` -- unaffected, should pass as-is
- [ ] `blockchain/test/HeritageSplitter.t.sol` -- update SPL tests for new releasePrimary behavior
- [ ] `blockchain/test/HeritageNFT.t.sol` -- update: remove marketplace tests, add Enumerable + free transfer tests
- [ ] `blockchain/test/HeritageFactory.t.sol` -- update: expect trio deployment, verify vault in struct
- [ ] `blockchain/test/HeritageMarketplace.t.sol` -- DELETE entirely (marketplace removed from NFT)
- [ ] Backend: existing work status flow tests (draft -> pending_approval -> approved -> ready_to_deploy -> deployed)
- [ ] Frontend: existing WorkLayout status banners and action buttons
