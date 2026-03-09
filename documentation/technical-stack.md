# Technical Stack

## Stack Overview

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Frontend | SolidJS + TypeScript | 1.9.x | Reactive UI with fine-grained updates |
| Styling | Tailwind CSS | 4.x | Utility-first CSS framework |
| Wallet | Web3-Onboard | 3.x | Framework-agnostic wallet connection |
| Chain Client | viem | 2.x | Type-safe Ethereum interactions |
| Date Picker | Flatpickr | 4.6.x | Lightweight date input |
| Backend | Rust + Axum | 1.93 / 0.8.x | Async HTTP server with tower middleware |
| ORM | sqlx | 0.8.x | Compile-time verified SQL queries |
| Database | SQLite | 3.x | Embedded relational database |
| Blockchain SDK | ethers-rs | 2.x | Contract deployment and interaction |
| Crypto | AES-256-GCM | - | Document encryption |
| Object Storage | MinIO | Latest | S3-compatible file storage |
| Smart Contracts | Solidity | 0.8.22 | EVM smart contracts |
| Contract Tooling | Foundry (forge) | Latest | Compilation, testing, deployment |
| Reverse Proxy | Caddy | 2.x | Automatic HTTPS, HTTP/2 |
| Orchestration | Kubernetes | 1.30+ | Container orchestration |
| Dev Environment | Tilt | Latest | Hot-reload k8s development |
| E2E Testing | Playwright | 1.50+ | Browser-based end-to-end tests |
| Blockchain | Avalanche C-Chain | - | EVM-compatible L1, sub-second finality |

## Why Each Technology

### SolidJS over React
SolidJS compiles to direct DOM operations — no virtual DOM diffing. This results in faster updates for real-time data (WebSocket notifications, blockchain state polling). The reactive primitive model (signals) aligns naturally with blockchain state that changes asynchronously. Bundle size is ~7KB vs React's ~40KB. The JSX syntax made migration from early React prototypes straightforward.

### Rust + Axum over Node.js/Express
The backend performs concurrent blockchain RPC calls (deploy, mint, list, query) that benefit from Rust's zero-cost async runtime (Tokio). Memory safety guarantees eliminate an entire class of vulnerabilities (buffer overflows, use-after-free). The compile-time type system catches errors that would only surface at runtime in JavaScript. Axum's tower middleware ecosystem provides composable layers (auth, rate limiting, CORS). Trade-off: steeper learning curve, but the safety and performance gains are critical for a financial application managing private keys.

### SQLite over PostgreSQL
SQLite provides zero-configuration deployment — the database is a single file. Combined with sqlx's compile-time query verification, we get type safety without an external database server. For the hackathon and early stage, this eliminates operational complexity (no connection pooling, no migrations server, no backup infrastructure). The migration path to PostgreSQL is straightforward since sqlx abstracts the driver layer and our queries use standard SQL.

### viem over ethers.js
viem is TypeScript-first with full type inference for ABI interactions. It generates typed contract functions at compile time, catching ABI mismatches early. Lighter weight than ethers.js v6 (tree-shakeable). Better error messages for debugging failed transactions.

### MinIO over IPFS
IPFS requires pinning services (Pinata, Infura) to ensure content availability — adding cost and external dependencies. IPFS content addressing also means any change requires a new CID, complicating metadata updates during draft phase. MinIO provides S3-compatible storage that we fully control, with predictable latency and no gateway bottlenecks. In production, a CDN layer (Cloudflare/CloudFront) would be added in front for global distribution.

### Avalanche over Ethereum/Polygon
Sub-second finality means transactions are confirmed almost instantly — critical for a marketplace UX where buyers expect immediate confirmation. Transaction fees are ~$0.01 vs Ethereum's $5-50+. Full EVM compatibility means standard Solidity tooling works without modification. The C-Chain uses Snowman consensus which provides deterministic finality (no reorgs). Strong ecosystem support for NFT projects.

### Foundry over Hardhat
Foundry is written in Rust, providing significantly faster compilation and test execution. Native fuzzing support catches edge cases automatically. Forge's `vm.prank`, `vm.deal`, and `vm.expectRevert` make test writing expressive. Gas snapshots for optimization. Solidity-native tests (no JavaScript test runner needed).

### Direct RPC over TheGraph
Avalanche's sub-second finality means on-chain state is immediately consistent — no need to wait for indexer sync. Our read patterns are simple (check listing status, verify ownership, read prices) and don't require historical event aggregation. This eliminates a dependency, reduces infrastructure costs, and avoids indexer latency. For complex analytics in the future, TheGraph would be added as a complementary read layer.

### Caddy over Nginx
Caddy provides automatic HTTPS with built-in ACME (Let's Encrypt) support — zero configuration. HTTP/2 by default. The Caddyfile syntax is dramatically simpler than nginx.conf for our use case (static files + reverse proxy). Built-in file server with proper caching headers.

### Kubernetes + Tilt over Docker Compose
Kubernetes provides the production deployment target (scaling, health checks, rolling updates, network policies). Tilt wraps Kubernetes for development, providing hot-reload workflows where code changes automatically rebuild and redeploy containers. This means dev and prod use the same deployment manifests, eliminating "works on my machine" issues.
