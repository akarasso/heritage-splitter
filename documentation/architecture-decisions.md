# Architecture Decisions

## ADR-001: Push-First, Pull-Fallback Payment Pattern

**Context**: Revenue from NFT sales must be distributed to multiple beneficiaries reliably.

**Decision**: PaymentRegistry uses a hybrid push/pull pattern. ETH is sent immediately with a 2300 gas stipend (reentrancy-safe). If the push fails (contract recipient), funds are stored for manual withdrawal.

**Rationale**: Pure pull patterns (OpenZeppelin PullPayment) require every recipient to claim manually — bad UX for artists. Pure push patterns can fail silently for contract wallets. The hybrid approach gives immediate payment for EOAs (99% of users) with a safe fallback for contracts.

**Trade-offs**: Slightly higher gas cost per payment (check + fallback logic). Accepted because reliability > gas optimization.

---

## ADR-002: Factory Pattern for Collection Deployment

**Context**: Each collection needs paired contracts (NFT + Splitter) that reference each other.

**Decision**: CollectionFactory deploys both contracts in a single transaction and maintains an on-chain registry.

**Rationale**: Ensures consistent initialization (the splitter address is immutably set in the NFT contract at creation). Provides a trustable on-chain list of all legitimate collections. Reduces error surface (no manual wiring of contract addresses). Enables future upgrades to deployment logic without changing existing contracts.

**Trade-offs**: Higher factory deployment gas cost. Acceptable as it's a one-time cost.

---

## ADR-003: Delegated Minting via Backend Wallet

**Context**: Artists need to mint NFTs without paying gas.

**Decision**: CollectionNFT has a `minter` role (backend wallet address) that can mint and list NFTs on behalf of the artist.

**Rationale**: Artists should focus on creating, not managing gas tokens. The backend pays gas for minting and listing, enabling a gasless experience for artists. The minter role is revocable by the contract owner (the artist) at any time.

**Trade-offs**: Introduces trust in the backend wallet for minting operations. Mitigated by: (1) minter can only mint, not transfer or burn existing tokens, (2) artist retains owner role and can revoke minter, (3) all mint operations are logged on-chain.

---

## ADR-004: EIP-712 Meta-Transactions for Document Certification

**Context**: Document certification requires an on-chain transaction, but artists may not have AVAX.

**Decision**: DocumentRegistry supports `certifyFor()` with EIP-712 typed signatures. The certifier signs off-chain; the backend submits the transaction.

**Rationale**: Enables gasless document certification. EIP-712 provides structured signing (users see clear data in MetaMask, not hex bytes). Replay protection via per-address nonces. Deadline parameter prevents stale signatures.

**Trade-offs**: Backend pays gas for certifications. Acceptable because document certification is infrequent and low-cost on Avalanche (~$0.002 per tx).

---

## ADR-005: SQLite for MVP with PostgreSQL Migration Path

**Context**: Need a database that's easy to deploy and maintain during rapid development.

**Decision**: Use SQLite with sqlx (compile-time verified queries) for the MVP. Plan migration to PostgreSQL for production.

**Rationale**: Zero-configuration deployment (single file). No connection pooling complexity. Compile-time SQL verification catches type errors at build time. Backup = copy a file. sqlx abstracts the driver layer, so migration to PostgreSQL requires minimal query changes (mainly `?` → `$1` parameter syntax).

**Trade-offs**: Single-writer limitation (SQLite uses file-level locking). Acceptable for MVP traffic. WAL mode enables concurrent reads.

---

## ADR-006: Showroom as Separate Contract (Not NFTMarket Extension)

**Context**: Producers need margin markup on NFT sales. Could either extend NFTMarket or create a separate Showroom contract.

**Decision**: Showroom is a separate contract that wraps NFTMarket listings.

**Rationale**: Separation of concerns: NFTMarket handles escrow and primary sales, Showroom handles curation and margins. A producer can be swapped without affecting the underlying market. Multiple showrooms can reference the same market listings. Each showroom has its own owner and payment configuration.

**Trade-offs**: Two transactions on the blockchain side (Showroom → NFTMarket). Slightly higher gas for showroom purchases. Acceptable because the architectural clarity outweighs the gas cost.

---

## ADR-007: Basis Points for Allocation Precision

**Context**: Need to define revenue split percentages between collaborators.

**Decision**: Use basis points (10,000 = 100%) instead of percentages or fractions.

**Rationale**: Integer arithmetic avoids floating-point precision issues in Solidity. 10,000 bps provides 0.01% granularity — sufficient for any practical allocation. Consistent with financial industry standards. Easy to validate: shares must sum to exactly 10,000.

**Trade-offs**: Slightly less intuitive than percentages for end users. Mitigated by frontend display showing both bps and percentage.

---

## ADR-008: WebSocket for Real-Time Notifications

**Context**: Users need to see invitations, approvals, and messages in real-time without polling.

**Decision**: Backend maintains a broadcast channel. Authenticated WebSocket connections receive events filtered by user_id.

**Rationale**: WebSocket provides instant delivery (vs polling every N seconds). Single persistent connection per user (vs multiple HTTP requests). Backend uses Tokio broadcast channel for efficient fan-out. Events are typed (notification, dm_received, invitation_received, etc.) for selective handling.

**Trade-offs**: WebSocket connections consume server resources. Mitigated by: per-connection rate limiting, authentication on first message, automatic cleanup on disconnect.

---

## ADR-009: Role-Based Access at Application Level (Not Smart Contract Level)

**Context**: Artists and producers have different capabilities on the platform.

**Decision**: Role enforcement happens at the backend/frontend level. Smart contracts are role-agnostic (they enforce ownership and permissions, not business roles).

**Rationale**: Smart contracts enforce trustless invariants (who owns what, who gets paid). Business logic (who can create a project, who sees which pages) belongs in the application layer where it's flexible and updatable. Mixing business roles into contracts would make them rigid and expensive to upgrade.

**Trade-offs**: Role checks rely on the backend being honest. Acceptable because the financial invariants (payment splitting, NFT ownership) are enforced on-chain regardless of backend behavior.

---

## ADR-010: Two-Step Ownership Transfer on All Critical Contracts

**Context**: Ownership of smart contracts controls critical operations (minting, margin setting, fund rescue).

**Decision**: All contracts with ownership use a two-step transfer pattern: `transferOwnership(newOwner)` → `acceptOwnership()`.

**Rationale**: Prevents accidental ownership transfer to a wrong address (which would be irreversible). The new owner must actively accept, proving they control the address and intend to take ownership. Standard pattern used by OpenZeppelin's Ownable2Step.

**Trade-offs**: Two transactions instead of one for ownership transfer. Acceptable given the catastrophic cost of transferring to a wrong address.
