# Security Model

## Authentication

### Wallet-Based Auth
No passwords. Users authenticate by signing a message with their Ethereum wallet:
1. Backend generates a random nonce per wallet address
2. Frontend requests signature via `personal_sign`
3. Backend recovers signer address from signature using `ecrecover`
4. JWT token issued (HS256, explicit algorithm validation)
5. Token includes: `user_id`, `wallet_address`, `exp` (expiry)

### Token Security
- JWT algorithm explicitly set to HS256 (prevents algorithm confusion attacks)
- Frontend checks token expiry before each request (clears expired tokens)
- Tokens stored in localStorage with HttpOnly cookie fallback
- Session logout clears both localStorage and server-side cookie

## Smart Contract Security

### Reentrancy Protection
- `ReentrancyGuard` on all payment functions: `purchase()`, `purchaseFor()`, `claimRefund()`, `withdraw()`
- PaymentRegistry uses 2300 gas stipend for push payments (prevents reentrancy in receive hooks)

### Two-Step Ownership
All critical contracts (NFTMarket, Showroom, PaymentRegistry) use two-step ownership transfer:
- `transferOwnership(newOwner)` → proposes transfer
- `acceptOwnership()` → new owner confirms
- Prevents accidental transfer to wrong address

### Slippage Protection
- `NFTMarket.purchase()` validates `msg.value >= price` at execution time
- `Showroom.purchase()` reads base price from market at execution time (not cached)
- Prevents front-running attacks where price could be changed between user's decision and transaction confirmation

### Access Control
- `onlyOwner`: Contract owner for administrative functions
- `onlyOwnerOrMinter`: NFT minting delegated to backend wallet
- `onlyOwnerOrDeployer`: Showroom management delegated to backend
- Minter/deployer roles are revocable by owner at any time

### Upgrade Safety
- PaymentRegistry deployed behind TransparentUpgradeableProxy
- 50 storage slots reserved for future upgrades (`__gap[45]` + 5 used)
- Constructor disabled (uses `initializer` pattern)

## Backend Security

### Rate Limiting
- **Per-user**: 60 requests/minute on all authenticated endpoints
- **Per-IP**: 10 requests/minute on auth endpoints (prevents brute force)
- **WebSocket**: Per-connection rate limiting
- Rate limit exceeded returns `429 Too Many Requests`

### Input Validation
- Display name: max 100 characters
- Bio: max 2000 characters
- Showroom name: max 200 characters, description: max 5000 characters
- Image upload: MIME type validation (PNG, JPEG, GIF, WebP only)
- Image size limits: avatar 2MB, logo 10MB, NFT 10MB
- MinIO key validation: rejects path traversal (`..`) and unsafe characters
- Decimal price validation: non-negative, max 1000 AVAX
- NFT contract address validation: starts with "0x", 42 characters

### Document Encryption
- Documents encrypted with AES-256-GCM before storage in MinIO
- Random IV generated per document
- Encryption key and IV stored in database
- Access controlled per-user via `document_access` table
- Only authorized users can trigger decryption and download

### Headers
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` (HSTS)
- CORS configured for frontend origin only
- Request body limits: 2MB standard, 50MB for file uploads

### Audit Logging
All sensitive operations are logged to `audit_logs` table:
- Contract deployments
- Document access grants/revocations
- Participant management
- Configuration changes

## Frontend Security

### Error Handling
- Production: generic "An unexpected error occurred" message
- Development: detailed error logging to console
- No stack traces or internal details exposed to users

### Image Validation
- Client-side MIME type and size validation before upload
- `sanitizeImageUrl()` only allows: MinIO keys (`nft/`, `avatar/`, `logo/`), safe `data:image/` URIs, `/api/` paths
- No arbitrary URL passthrough

### Token Management
- JWT payload decoded and `exp` checked before each API request
- Expired tokens cleared automatically
- Session state cleared on `401 Unauthorized` responses

## Infrastructure Security

### Container Hardening
- Non-root user in all containers (`appuser`, uid 1000)
- `allowPrivilegeEscalation: false`
- `readOnlyRootFilesystem: true` (frontend, with emptyDir for Caddy data)
- `automountServiceAccountToken: false`
- `seccompProfile: RuntimeDefault`
- Docker images pinned by SHA256 digest

### Network Policies
- Backend: ingress only from frontend, egress to DNS + HTTPS (RPC, external APIs)
- Frontend: ingress from ingress controller, egress to DNS + backend
- MinIO: ingress only from backend on port 9000

### Production Ingress
- TLS via cert-manager (Let's Encrypt)
- Force SSL redirect
- Nginx rate limiting: 10 RPS with 5x burst multiplier
- Request body size: 20MB
- HTTP/2 enabled

## Testing

### Smart Contract Tests
- **94 tests** across 7 test suites (Foundry)
- Coverage: deployment, minting, purchasing, splitting, showroom, document certification
- Edge cases: reentrancy, overflow, access control violations

### Backend Tests
- **19 tests** (Rust integration tests)
- Coverage: showroom CRUD, listings, participants, auth

### End-to-End Tests
- **33 tests** (Playwright, real browser)
- Full user journeys: onboarding → project → collection → deploy → mint → publish → purchase → showroom
- 4 user personas (2 artists, 1 producer, 1 buyer)
