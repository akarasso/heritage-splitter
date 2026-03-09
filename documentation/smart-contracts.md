# Smart Contracts

All contracts are written in Solidity 0.8.22, compiled and tested with Foundry. 94 tests pass across 7 test suites.

## Contract Map

```
CollectionFactory (deployer)
       │
       ├──► CollectionNFT (ERC-721 + ERC-2981)
       │         │
       │         ├── mint / mintBatch (minter role)
       │         ├── burn / burnBatch (token owner)
       │         └── royaltyInfo → returns splitter address
       │
       └──► ArtistsSplitter (payment distributor)
                 │
                 └── receive() → splits ETH among beneficiaries
                       │
                       └── PaymentRegistry.pay(beneficiary, amount)

NFTMarket (primary marketplace)
       │
       ├── list / listBatch (hold NFTs in escrow)
       ├── purchase(listingId) → sends payment to splitter
       ├── purchaseFor(listingId, recipient) → used by Showroom
       └── delist / setPrice

Showroom (producer storefront)
       │
       ├── addItem / addItemBatch (link to NFTMarket listings + margin)
       ├── purchase(nft, tokenId) → base to market, margin to producer
       └── setMargin / removeItem

PaymentRegistry (upgradeable proxy)
       │
       ├── pay(beneficiary) → push-first (2300 gas), pull-fallback
       └── withdraw() → claim deferred payments

DocumentRegistry (EIP-712 certification)
       │
       ├── certify(hash) → direct owner certification
       └── certifyFor(hash, certifier, deadline, signature) → meta-tx
```

---

## CollectionFactory

**Purpose**: Factory pattern for deploying paired NFT + payment splitter contracts.

**Key Functions**:
- `createCollection(name, symbol, owner, wallets[], shares[], royaltyBps, contractURI, registry, minterAddr)` → (index, nftAddr, splitterAddr)
- `setAuthorizedRegistry(address)` — Owner-only. Restricts which PaymentRegistry can be used.
- `getOwnerCollections(owner)` → uint256[] of collection indices
- `collectionCount()` → total deployed

**Events**: `CollectionCreated(index, nft, splitter, owner, name, symbol)`

**Access Control**: `onlyOwner` for registry configuration

---

## CollectionNFT

**Purpose**: ERC-721 with enumeration, URI storage, and ERC-2981 royalty standard.

**Inheritance**: ERC721 → ERC721Enumerable → ERC721URIStorage → ERC721Royalty → Ownable

**Key Functions**:
- `mint(to, uri)` → tokenId (owner or minter)
- `mintBatch(to, uris[])` → tokenId[] (max 100, owner or minter)
- `burn(tokenId)` — Token owner only
- `burnBatch(tokenIds[])` — Token owner only, max 100
- `setMinter(address)` / `revokeMinter()` — Owner manages minter role
- `contractURI()` → Collection-level metadata URI

**Royalty Flow**: `royaltyInfo(tokenId, salePrice)` returns (splitter address, royalty amount). The splitter is set immutably at deployment.

**Events**: `Minted`, `BatchMinted`, `MinterUpdated`, `Burned`

---

## ArtistsSplitter

**Purpose**: Proportional payment splitter. Receives ETH and distributes to beneficiaries via PaymentRegistry.

**Key Functions**:
- `receive()` — Automatically distributes incoming ETH:
  - Calculates `amount = (total * shares[i]) / totalShares` for each beneficiary
  - Last beneficiary absorbs rounding dust
  - Calls `registry.pay{value: amount}(beneficiary)` for each
- `getBeneficiaries()` → Beneficiary[] (wallet, shares)
- `beneficiaryCount()` → uint256
- `rescueETH(to)` — Owner only, rescues stuck ETH

**Constraints**:
- Max 50 beneficiaries
- Shares must sum to exactly 10,000 (= 100%)
- No duplicate wallet addresses

**Protection**: ReentrancyGuard on `receive()`

---

## NFTMarket

**Purpose**: Multi-collection primary marketplace with pull-fallback refund pattern.

**Key Functions**:
- `list(nft, tokenId, price)` → listingId — Transfers NFT to market (escrow)
- `listBatch(nfts[], tokenIds[], prices[])` → listingId[] (max 100)
- `delist(listingId)` — Returns NFT to seller
- `setPrice(listingId, newPrice)` — Update listing price
- `purchase(listingId)` payable — Buyer gets NFT, payment → splitter
- `purchaseFor(listingId, recipient)` payable — Used by Showroom, NFT → recipient
- `listAvailable(offset, limit)` → paginated Listing[]
- `claimRefund()` — Claim pending overpayment refunds

**Events**: `Listed`, `Delisted`, `PriceUpdated`, `NFTPurchased`, `RefundFailed`, `RefundClaimed`

**Protection**: ReentrancyGuard on `purchase()`, `purchaseFor()`, `claimRefund()`

---

## Showroom

**Purpose**: Producer storefront with margin markup on NFTMarket listings.

**Key Functions**:
- `addItem(nft, tokenId, market, listingId, margin)` — Link a market listing with margin
- `addItemBatch(...)` — Max 100 items
- `removeItem(nft, tokenId)` / `removeItemBatch(...)`
- `setMargin(nft, tokenId, newMargin)` / `setMarginBatch(...)`
- `purchase(nft, tokenId)` payable:
  1. Reads base price from NFTMarket
  2. Total = base + margin
  3. Calls `market.purchaseFor(listingId, msg.sender)` with base price
  4. Calls `registry.pay(owner)` with margin
  5. Refunds overpayment
- `listAvailable()` → All active items with prices and margins
- `transferOwnership(newOwner)` — Two-step transfer
- `setDeployer(address)` / `revokeDeployer()` — Backend wallet management

**Events**: `ItemAdded`, `ItemRemoved`, `MarginUpdated`, `ItemPurchased`, `RefundFailed`

**Protection**: ReentrancyGuard on `purchase()`, `claimRefund()`

---

## PaymentRegistry

**Purpose**: Platform-wide payment ledger using push-first, pull-fallback pattern. Deployed behind TransparentUpgradeableProxy.

**Key Functions**:
- `initialize(owner)` — One-time initializer (proxy pattern)
- `pay(beneficiary)` payable:
  - Tries to send ETH with 2300 gas stipend (reentrancy-safe)
  - If fails → stored in `pendingWithdrawals[beneficiary]`
  - Emits `PaymentSent` or `PaymentDeferred`
- `withdraw()` — Beneficiary claims deferred payments
- `transferOwnership(newOwner)` / `acceptOwnership()` — Two-step

**Events**: `PaymentSent`, `PaymentDeferred`, `Withdrawn`

**Upgrade Safety**: 50 storage slots reserved (`__gap[45]` + 5 used)

---

## DocumentRegistry

**Purpose**: On-chain document certification with EIP-712 meta-transaction support.

**Key Functions**:
- `certify(hash)` — Owner certifies directly
- `certifyFor(hash, certifier, deadline, signature)` — Meta-transaction:
  - Verifies `deadline > block.timestamp`
  - Recovers signer from EIP-712 typed signature
  - Increments `nonces[certifier]` for replay protection
- `getCertification(hash)` → timestamp (0 if not certified)

**EIP-712 Type**: `Certify(bytes32 hash, address certifier, uint256 nonce, uint256 deadline)`

**Events**: `DocumentCertified(hash, certifier, timestamp)`
