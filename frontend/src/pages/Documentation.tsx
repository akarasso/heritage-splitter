import { createSignal, For, Show } from "solid-js";

type Tab = "overview" | "architecture" | "stack";

export default function Documentation() {
  const [tab, setTab] = createSignal<Tab>("overview");

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Product Overview" },
    { id: "architecture", label: "Architecture" },
    { id: "stack", label: "Technical Stack" },
  ];

  return (
    <div class="max-w-5xl mx-auto px-6 py-10">
      {/* Header */}
      <div class="mb-8">
        <p class="text-xs font-medium tracking-widest uppercase mb-3" style={{ color: "var(--text-muted)" }}>
          Heritage Splitter
        </p>
        <h1 class="font-display text-3xl font-bold mb-2" style={{ color: "var(--cream)" }}>
          Documentation
        </h1>
        <p class="text-sm" style={{ color: "var(--text-muted)" }}>
          Everything you need to know about Heritage Splitter — from product vision to technical architecture.
        </p>
      </div>

      {/* Tabs */}
      <div class="flex gap-1 mb-8 p-1 rounded-xl" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <For each={tabs}>
          {(t) => (
            <button
              class="flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all"
              style={{
                background: tab() === t.id ? "var(--surface-light)" : "transparent",
                color: tab() === t.id ? "var(--gold)" : "var(--text-muted)",
                border: tab() === t.id ? "1px solid var(--border-light)" : "1px solid transparent",
              }}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          )}
        </For>
      </div>

      {/* ════════════════════════════════════════════════ */}
      {/* TAB: PRODUCT OVERVIEW                           */}
      {/* ════════════════════════════════════════════════ */}
      <Show when={tab() === "overview"}>
        <div class="space-y-8 animate-fade-in">
          {/* What is Heritage Splitter */}
          <Section title="What is Heritage Splitter?">
            <p>
              Heritage Splitter is a decentralized platform built on Avalanche that enables artists and producers
              to collaboratively create, manage, and sell NFT collections with <Gold>transparent and automated revenue distribution</Gold>.
            </p>
            <p>
              The platform solves a fundamental problem in the art world: when multiple creators collaborate on a collection,
              managing revenue splits, royalties, and rights transfers becomes complex and opaque.
              Heritage Splitter makes this trustless and automatic through smart contracts.
            </p>
            <p>
              Every payment — whether from a primary sale or secondary royalty — is split on-chain according to
              pre-agreed allocations, with no intermediary and no manual distribution.
            </p>
          </Section>

          {/* For Artists */}
          <Section title="For Artists" badge="Leo's perspective">
            <p>
              As an artist, Heritage Splitter lets you <Gold>protect your intellectual property</Gold> and
              earn fair compensation from your work — automatically and transparently.
            </p>
            <ul>
              <li><Gold>Create projects</Gold> — Define your artistic vision, invite collaborators, and set allocation shares before anything goes on-chain.</li>
              <li><Gold>Mint NFT collections</Gold> — Upload artwork, set metadata and prices. Deploy with one click. Your NFTs are ERC-721 with ERC-2981 royalties built in.</li>
              <li><Gold>Collaborative governance</Gold> — Every participant must approve the allocation terms before deployment. No surprises.</li>
              <li><Gold>Certify documents</Gold> — Upload contracts, certificates of authenticity, or any document. Get an on-chain SHA-256 timestamp proof via EIP-712 signatures.</li>
              <li><Gold>Automatic royalties</Gold> — On every sale (primary and secondary), your share is calculated and sent to you automatically via the ArtistsSplitter contract.</li>
              <li><Gold>Share with showrooms</Gold> — Propose your deployed collections to producer showrooms to reach a wider audience.</li>
            </ul>
          </Section>

          {/* For Producers */}
          <Section title="For Producers" badge="Gil's perspective">
            <p>
              As a producer, Heritage Splitter gives you the tools to <Gold>curate, showcase, and sell NFT art</Gold> through
              your own digital storefront — the Showroom.
            </p>
            <ul>
              <li><Gold>Create showrooms</Gold> — Your branded digital gallery. Invite artists, curate collections, and set your margin on each piece.</li>
              <li><Gold>Invite artists</Gold> — Search and invite artists to your showroom. They can propose their deployed collections for you to sell.</li>
              <li><Gold>Set margins</Gold> — Define your producer margin on top of each NFT's base price. The margin goes directly to you, the base price to the artists' splitter.</li>
              <li><Gold>Deploy on-chain</Gold> — Deploy your showroom as a smart contract on Avalanche. Buyers pay the total price (base + margin) in one transaction.</li>
              <li><Gold>Publish a sale page</Gold> — Generate a public URL for your showroom. Share it with collectors. No account needed to browse and buy.</li>
              <li><Gold>Manage documents</Gold> — Attach legal documents, certificates, and agreements to your showroom. Certify them on-chain.</li>
            </ul>
          </Section>

          {/* Key Features */}
          <Section title="Key Features">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FeatureCard title="On-chain Revenue Splitting" desc="Every payment is split automatically by the ArtistsSplitter contract. Shares are defined in basis points (10,000 = 100%). No manual distribution." />
              <FeatureCard title="ERC-2981 Royalties" desc="Secondary sale royalties are enforced via the ERC-2981 standard. Marketplaces that support it will automatically send royalties to the splitter." />
              <FeatureCard title="Document Certification" desc="Upload documents and get an on-chain proof of existence. Uses EIP-712 typed signatures and SHA-256 hashing for tamper-proof certification." />
              <FeatureCard title="KYC Onboarding" desc="Identity verification at registration ensures every participant is a verified individual. Role-based access: artists create, producers curate." />
              <FeatureCard title="Real-time Collaboration" desc="WebSocket-powered notifications for invitations, approvals, messages, and status changes. Threaded discussions on projects and collections." />
              <FeatureCard title="Showroom Marketplace" desc="Producers deploy on-chain showrooms with margin markup. Buyers see a clean storefront. One transaction covers base price + margin." />
            </div>
          </Section>

          {/* Network */}
          <div class="card" style={{ padding: "20px 24px" }}>
            <div class="flex items-center gap-3 mb-3">
              <div style={{ width: "6px", height: "6px", "border-radius": "50%", background: "var(--emerald)" }} />
              <span class="text-sm font-medium" style={{ color: "var(--cream)" }}>Network Information</span>
            </div>
            <div class="text-xs space-y-1.5" style={{ color: "var(--text-muted)", "line-height": "1.6" }}>
              <p>Network: Avalanche Fuji Testnet (Chain ID: 43113)</p>
              <p>RPC: https://api.avax-test.network/ext/bc/C/rpc</p>
              <p>Explorer: https://testnet.snowtrace.io</p>
              <p>Consensus: Snowman (sub-second finality)</p>
              <p>Token: AVAX (18 decimals)</p>
            </div>
          </div>
        </div>
      </Show>

      {/* ════════════════════════════════════════════════ */}
      {/* TAB: ARCHITECTURE                               */}
      {/* ════════════════════════════════════════════════ */}
      <Show when={tab() === "architecture"}>
        <div class="space-y-8 animate-fade-in">
          {/* System Overview */}
          <Section title="System Overview">
            <p>Heritage Splitter follows a <Gold>three-tier architecture</Gold> with a clear separation between the presentation layer (SolidJS),
            the application layer (Rust/Axum), and the blockchain layer (Solidity smart contracts on Avalanche).</p>
            <CodeBlock code={`┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (SolidJS)                       │
│  Wallet Connection ─── API Client ─── Real-time WebSocket       │
│  MetaMask/Web3-Onboard    REST          Notifications           │
└──────────────┬───────────────┬──────────────────┬───────────────┘
               │               │                  │
               │          ┌────▼────┐             │
               │          │  Caddy  │ (reverse    │
               │          │  Proxy  │  proxy)     │
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
│                              │                                   │
│                      DocumentRegistry                            │
└─────────────────────────────────────────────────────────────────┘`} />
          </Section>

          {/* Smart Contract Architecture */}
          <Section title="Smart Contract Architecture">
            <p>Seven contracts form the on-chain backbone. Each serves a specific role:</p>
            <div class="space-y-3 mt-4">
              <ContractCard name="CollectionFactory" desc="Factory pattern — deploys paired CollectionNFT + ArtistsSplitter contracts in a single transaction. Maintains a registry of all deployed collections per owner." />
              <ContractCard name="CollectionNFT" desc="ERC-721 Enumerable + ERC-2981 Royalties. Supports single and batch minting (up to 100), burn, and delegated minting via a 'minter' role (backend wallet for gasless operations)." />
              <ContractCard name="ArtistsSplitter" desc="Automatic revenue distribution. Receives ETH and splits it proportionally among beneficiaries (basis points, 10000 = 100%). Forwards each share to PaymentRegistry." />
              <ContractCard name="NFTMarket" desc="Multi-collection primary marketplace. Holds NFTs in escrow, handles purchases with slippage protection (maxPrice). Sends payment directly to the collection's splitter." />
              <ContractCard name="Showroom" desc="Producer storefront. Wraps NFTMarket listings with a margin. On purchase: base price goes to market → splitter → artists; margin goes to producer via PaymentRegistry." />
              <ContractCard name="PaymentRegistry" desc="Platform-wide payment ledger (upgradeable proxy). Push-first pattern: tries to send ETH immediately (2300 gas), falls back to pull-based withdrawal if the recipient is a contract." />
              <ContractCard name="DocumentRegistry" desc="On-chain document certification via EIP-712 typed signatures. Stores SHA-256 hash → timestamp mapping. Supports meta-transactions for gasless certification." />
            </div>
          </Section>

          {/* Payment Flow */}
          <Section title="Payment Flow">
            <p>Revenue flows through a carefully designed pipeline that ensures <Gold>every participant gets paid automatically</Gold>.</p>
            <CodeBlock code={`PRIMARY SALE (Direct from NFTMarket):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Buyer pays ──► NFTMarket.purchase()
                    │
                    ├── NFT transferred to buyer
                    │
                    └── Full payment ──► ArtistsSplitter.receive()
                                              │
                                              ├── Artist A (60%) ──► PaymentRegistry.pay()
                                              ├── Artist B (30%) ──► PaymentRegistry.pay()
                                              └── Producer  (10%) ──► PaymentRegistry.pay()

SHOWROOM SALE (Via producer storefront):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Buyer pays (base + margin) ──► Showroom.purchase()
                                    │
                                    ├── Base price ──► NFTMarket.purchaseFor()
                                    │                       │
                                    │                       └── (same split as above)
                                    │
                                    └── Margin ──► PaymentRegistry.pay(producer)

SECONDARY SALE (ERC-2981 Royalties):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Any marketplace ──► royaltyInfo(tokenId, salePrice)
                         │
                         └── Returns (splitter address, royalty amount)
                              │
                              └── Marketplace sends royalty ──► ArtistsSplitter
                                                                    │
                                                                    └── (same proportional split)`} />
          </Section>

          {/* On-chain vs Off-chain */}
          <Section title="On-chain vs Off-chain Logic">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="rounded-xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                <h4 class="text-sm font-semibold mb-3" style={{ color: "var(--emerald)" }}>On-chain (Immutable)</h4>
                <ul class="text-xs space-y-2" style={{ color: "var(--cream-muted)" }}>
                  <li>NFT ownership and transfers (ERC-721)</li>
                  <li>Revenue splitting logic (ArtistsSplitter)</li>
                  <li>Royalty enforcement (ERC-2981)</li>
                  <li>Primary sale marketplace (NFTMarket)</li>
                  <li>Showroom purchases and margins</li>
                  <li>Payment registry (push/pull)</li>
                  <li>Document certification timestamps</li>
                  <li>Collection factory and deployment</li>
                </ul>
              </div>
              <div class="rounded-xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                <h4 class="text-sm font-semibold mb-3" style={{ color: "var(--gold)" }}>Off-chain (Flexible)</h4>
                <ul class="text-xs space-y-2" style={{ color: "var(--cream-muted)" }}>
                  <li>User profiles and KYC data</li>
                  <li>Project collaboration workflow</li>
                  <li>Allocation negotiation and approval</li>
                  <li>NFT metadata and images (MinIO)</li>
                  <li>Document encryption (AES-256-GCM)</li>
                  <li>Threaded discussions and DMs</li>
                  <li>Real-time notifications (WebSocket)</li>
                  <li>Showroom curation and invitations</li>
                </ul>
              </div>
            </div>
            <p class="mt-4">
              The guiding principle: <Gold>financial logic is always on-chain</Gold> (trustless, verifiable), while
              collaboration workflows remain off-chain for flexibility and user experience.
              The backend acts as a facilitator — it deploys contracts, mints NFTs, and relays transactions,
              but it never holds or controls user funds.
            </p>
          </Section>

          {/* Security Model */}
          <Section title="Security Model">
            <ul>
              <li><Gold>Wallet-based authentication</Gold> — No passwords. Users sign a message with their wallet to prove ownership. JWT tokens with HS256 and explicit algorithm validation.</li>
              <li><Gold>Two-step ownership</Gold> — All critical contracts use a two-step ownership transfer pattern (propose → accept) to prevent accidental transfers.</li>
              <li><Gold>Reentrancy protection</Gold> — ReentrancyGuard on all payment-related functions (purchase, withdraw, claimRefund).</li>
              <li><Gold>Push-first, pull-fallback</Gold> — Payments are sent immediately with a 2300 gas limit. If the transfer fails (e.g., contract recipient), funds are stored for manual withdrawal.</li>
              <li><Gold>Rate limiting</Gold> — Per-user rate limiting on all authenticated endpoints. Per-IP rate limiting on auth endpoints.</li>
              <li><Gold>Document encryption</Gold> — Documents are encrypted with AES-256-GCM before storage. Decryption keys are stored in the database, access is role-based.</li>
              <li><Gold>Input validation</Gold> — Backend validates all inputs (lengths, formats, ranges). Frontend validates file types and sizes before upload.</li>
              <li><Gold>Slippage protection</Gold> — NFT purchases include a maxPrice parameter to prevent front-running attacks.</li>
            </ul>
          </Section>
        </div>
      </Show>

      {/* ════════════════════════════════════════════════ */}
      {/* TAB: TECHNICAL STACK                            */}
      {/* ════════════════════════════════════════════════ */}
      <Show when={tab() === "stack"}>
        <div class="space-y-8 animate-fade-in">
          {/* Stack Overview */}
          <Section title="Technology Stack">
            <div class="overflow-x-auto">
              <table class="w-full text-xs" style={{ "border-collapse": "separate", "border-spacing": "0" }}>
                <thead>
                  <tr>
                    <th class="text-left px-4 py-3 font-medium" style={{ color: "var(--text-muted)", background: "var(--surface)", "border-bottom": "1px solid var(--border)", "border-radius": "8px 0 0 0" }}>Layer</th>
                    <th class="text-left px-4 py-3 font-medium" style={{ color: "var(--text-muted)", background: "var(--surface)", "border-bottom": "1px solid var(--border)" }}>Technology</th>
                    <th class="text-left px-4 py-3 font-medium" style={{ color: "var(--text-muted)", background: "var(--surface)", "border-bottom": "1px solid var(--border)", "border-radius": "0 8px 0 0" }}>Rationale</th>
                  </tr>
                </thead>
                <tbody style={{ color: "var(--cream-muted)" }}>
                  <StackRow layer="Frontend" tech="SolidJS + TypeScript" rationale="Fine-grained reactivity without virtual DOM. Faster initial load and smaller bundle than React. Ideal for real-time UI updates (WebSocket events, blockchain state)." />
                  <StackRow layer="Styling" tech="Tailwind CSS v4" rationale="Utility-first approach for rapid UI development. Custom design system with CSS variables for consistent dark theme." />
                  <StackRow layer="Wallet" tech="Web3-Onboard v3" rationale="Framework-agnostic wallet connection. Supports MetaMask and any injected provider. Clean API for chain switching and transaction signing." />
                  <StackRow layer="Blockchain Client" tech="viem" rationale="TypeScript-first Ethereum library. Type-safe contract interactions, ABI encoding, and chain utilities. Lighter than ethers.js." />
                  <StackRow layer="Backend" tech="Rust + Axum" rationale="Memory safety without garbage collection. Axum provides async HTTP with tower middleware ecosystem. Excellent for concurrent blockchain RPC calls." />
                  <StackRow layer="Database" tech="SQLite + sqlx" rationale="Zero-configuration embedded database. Compile-time SQL verification with sqlx. Single-file backup. Sufficient for MVP scale with planned PostgreSQL migration path." />
                  <StackRow layer="Object Storage" tech="MinIO (S3-compatible)" rationale="Self-hosted S3-compatible storage for NFT images, avatars, and documents. Avoids IPFS pinning costs and centralized gateway dependencies." />
                  <StackRow layer="Smart Contracts" tech="Solidity 0.8.22 + Foundry" rationale="Industry-standard EVM language. Foundry provides fast compilation, fuzzing, and gas snapshots. 94 tests across 7 contracts." />
                  <StackRow layer="Blockchain" tech="Avalanche C-Chain" rationale="Sub-second finality, low fees (~$0.01 per tx), EVM-compatible. Ideal for frequent small transactions (NFT mints, purchases, certifications)." />
                  <StackRow layer="Proxy/CDN" tech="Caddy" rationale="Automatic HTTPS, HTTP/2, zero-config reverse proxy. Serves static frontend and proxies API calls to backend." />
                  <StackRow layer="Orchestration" tech="Kubernetes + Tilt" rationale="Production-grade container orchestration. Tilt provides hot-reload development with live container updates." />
                  <StackRow layer="CI/Testing" tech="Foundry + Playwright" rationale="Smart contract tests with forge. End-to-end browser tests with Playwright (33 tests covering full user journeys)." />
                </tbody>
              </table>
            </div>
          </Section>

          {/* Architecture Decisions */}
          <Section title="Architecture Decisions">
            <Decision
              title="Rust backend over Node.js"
              decision="We chose Rust with Axum for the backend instead of a more conventional Node.js/Express stack."
              rationale="The backend performs concurrent blockchain RPC calls (deploy, mint, list, query) that benefit from Rust's zero-cost async runtime (Tokio). Memory safety guarantees eliminate an entire class of vulnerabilities. The compile-time type system catches errors that would only surface at runtime in JavaScript. Trade-off: steeper learning curve, but the safety and performance gains are worth it for a financial application."
            />
            <Decision
              title="SolidJS over React"
              decision="SolidJS was chosen as the frontend framework instead of React or Vue."
              rationale="SolidJS compiles to direct DOM operations — no virtual DOM diffing. This results in faster updates for real-time data (WebSocket notifications, blockchain state polling). The reactive primitive model (signals) aligns naturally with blockchain state that changes asynchronously. Bundle size is ~7KB vs React's ~40KB. The JSX syntax made migration from React prototypes straightforward."
            />
            <Decision
              title="SQLite for MVP, PostgreSQL for production"
              decision="We use SQLite as the primary database with a planned migration to PostgreSQL."
              rationale="SQLite provides zero-configuration deployment — the database is a single file. Combined with sqlx's compile-time query verification, we get type safety without an external database server. For the hackathon and early stage, this eliminates operational complexity. The migration path to PostgreSQL is straightforward since sqlx abstracts the driver layer."
            />
            <Decision
              title="Direct RPC over indexer (TheGraph)"
              decision="We query the Avalanche C-Chain directly via JSON-RPC instead of using an indexer like TheGraph."
              rationale="Avalanche's sub-second finality means on-chain state is immediately consistent — there's no need to wait for indexer sync. Our read patterns are simple (check listing status, verify ownership, read prices) and don't require historical event aggregation. This eliminates a dependency, reduces infrastructure costs, and avoids the latency of subgraph indexing. For complex analytics in the future, we would add TheGraph as a complementary read layer."
            />
            <Decision
              title="Push-first, pull-fallback payment pattern"
              decision="PaymentRegistry uses a hybrid push/pull payment pattern instead of pure pull (withdraw)."
              rationale="Pure pull patterns (like OpenZeppelin's PullPayment) require every recipient to claim manually — poor UX for artists who just want to receive payment. Our push-first approach sends ETH immediately with a 2300 gas stipend (safe against reentrancy). If the recipient is a contract that can't receive with 2300 gas, funds are stored for manual withdrawal. This gives the best of both worlds: instant payment for EOAs, safe fallback for contracts."
            />
            <Decision
              title="Factory pattern for collection deployment"
              decision="Collections are deployed via a CollectionFactory rather than individual contract deployments."
              rationale="The factory pattern ensures consistent contract initialization (NFT + Splitter are always paired correctly), provides a registry of all collections per owner, and reduces deployment gas by using CREATE2 deterministic addresses. It also enables future upgrades to the deployment logic without changing the contract addresses."
            />
            <Decision
              title="MinIO over IPFS for storage"
              decision="NFT images and documents are stored in self-hosted MinIO instead of IPFS."
              rationale="IPFS requires pinning services (Pinata, Infura) to ensure content availability — adding cost and external dependencies. MinIO provides S3-compatible storage that we fully control. For the MVP, content availability is guaranteed by our infrastructure. NFT metadata URIs point to our API, which serves images from MinIO. In production, a CDN layer would be added in front."
            />
            <Decision
              title="EIP-712 for document certification"
              decision="Document certification uses EIP-712 typed signatures instead of direct on-chain calls."
              rationale="EIP-712 enables meta-transactions: the certifier signs the document hash off-chain, and the backend submits the transaction. This means artists don't need AVAX to certify documents — the platform covers gas costs. The typed signature also provides better wallet UX (users see structured data instead of raw bytes)."
            />
          </Section>

          {/* Implementation Approach */}
          <Section title="Implementation Approach">
            <p>The project was built in iterative phases, each adding a complete vertical slice of functionality:</p>
            <div class="space-y-4 mt-4">
              <Phase
                number={1}
                title="Core Contracts + Auth"
                desc="CollectionFactory, CollectionNFT, ArtistsSplitter deployed and tested. Backend authentication with wallet signature verification (personal_sign → JWT). User registration and profile management."
              />
              <Phase
                number={2}
                title="Collection Workflow"
                desc="Full project → collection → allocation → approval → deploy → mint pipeline. NFTMarket for primary sales. Draft NFT management with image upload to MinIO. Frontend collection pages with status-driven UI."
              />
              <Phase
                number={3}
                title="Collaboration Layer"
                desc="Participant invitations with accept/reject flow. Allocation negotiation (basis points). Threaded discussions on projects and collections. Real-time WebSocket notifications. Direct messaging between users."
              />
              <Phase
                number={4}
                title="Document Certification"
                desc="DocumentRegistry contract with EIP-712 signatures. Upload, encrypt (AES-256-GCM), store in MinIO. On-chain certification with timestamp proof. Public verification page."
              />
              <Phase
                number={5}
                title="Showroom & Producer Features"
                desc="Showroom contract with margin mechanics. Producer onboarding flow. Artist invitation to showrooms. Collection sharing and listing management. Public sale pages with wallet-based purchases."
              />
              <Phase
                number={6}
                title="Security Hardening & Testing"
                desc="Two security audits with full remediation. Rate limiting, input validation, HSTS headers. 94 smart contract tests, 19 backend tests, 33 E2E Playwright tests covering complete user journeys."
              />
            </div>
          </Section>
        </div>
      </Show>
    </div>
  );
}

/* ─── Reusable Components ─── */

function Gold(props: { children: any }) {
  return <span style={{ color: "var(--gold)", "font-weight": "600" }}>{props.children}</span>;
}

function Section(props: { title: string; badge?: string; children: any }) {
  return (
    <div>
      <div class="flex items-center gap-3 mb-4">
        <div style={{ width: "6px", height: "6px", "border-radius": "50%", background: "var(--gold)" }} />
        <h2 class="font-display text-lg font-semibold" style={{ color: "var(--gold)" }}>{props.title}</h2>
        <Show when={props.badge}>
          <span class="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "rgba(212,168,83,0.12)", color: "var(--gold)" }}>{props.badge}</span>
        </Show>
      </div>
      <div class="doc-prose text-sm space-y-3" style={{ color: "var(--cream-muted)", "line-height": "1.7" }}>
        {props.children}
      </div>
    </div>
  );
}

function FeatureCard(props: { title: string; desc: string }) {
  return (
    <div class="rounded-xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <h4 class="text-sm font-semibold mb-2" style={{ color: "var(--cream)" }}>{props.title}</h4>
      <p class="text-xs" style={{ color: "var(--text-muted)", "line-height": "1.6" }}>{props.desc}</p>
    </div>
  );
}

function ContractCard(props: { name: string; desc: string }) {
  return (
    <div class="flex gap-4 p-4 rounded-xl" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <code class="text-xs font-mono font-bold shrink-0 pt-0.5" style={{ color: "var(--gold)" }}>{props.name}</code>
      <p class="text-xs" style={{ color: "var(--cream-muted)", "line-height": "1.6" }}>{props.desc}</p>
    </div>
  );
}

function CodeBlock(props: { code: string }) {
  return (
    <div class="rounded-xl overflow-hidden mt-3" style={{ border: "1px solid var(--border)" }}>
      <pre
        class="font-mono"
        style={{
          margin: "0",
          padding: "16px 20px",
          background: "var(--noir)",
          "font-size": "0.68rem",
          "line-height": "1.5",
          color: "var(--cream-muted)",
          "overflow-x": "auto",
        }}
      >
        <code>{props.code}</code>
      </pre>
    </div>
  );
}

function StackRow(props: { layer: string; tech: string; rationale: string }) {
  return (
    <tr style={{ "border-bottom": "1px solid var(--border)" }}>
      <td class="px-4 py-3 font-medium" style={{ color: "var(--gold)", "white-space": "nowrap" }}>{props.layer}</td>
      <td class="px-4 py-3 font-mono" style={{ "white-space": "nowrap" }}>{props.tech}</td>
      <td class="px-4 py-3" style={{ "line-height": "1.5" }}>{props.rationale}</td>
    </tr>
  );
}

function Decision(props: { title: string; decision: string; rationale: string }) {
  return (
    <div class="rounded-xl p-5 mb-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <h4 class="text-sm font-semibold mb-2" style={{ color: "var(--cream)" }}>{props.title}</h4>
      <p class="text-xs mb-2" style={{ color: "var(--gold)" }}>{props.decision}</p>
      <p class="text-xs" style={{ color: "var(--text-muted)", "line-height": "1.6" }}>{props.rationale}</p>
    </div>
  );
}

function Phase(props: { number: number; title: string; desc: string }) {
  return (
    <div class="flex gap-4">
      <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold" style={{ background: "rgba(212,168,83,0.12)", color: "var(--gold)", border: "1px solid rgba(212,168,83,0.3)" }}>
        {props.number}
      </div>
      <div>
        <h4 class="text-sm font-semibold" style={{ color: "var(--cream)" }}>{props.title}</h4>
        <p class="text-xs mt-1" style={{ color: "var(--text-muted)", "line-height": "1.6" }}>{props.desc}</p>
      </div>
    </div>
  );
}
