# API Reference

Base URL: `/api`

## Authentication

Wallet-based authentication using `personal_sign` → JWT.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/nonce` | No | Get a signing nonce for a wallet address |
| POST | `/auth/verify` | No | Verify signature and get JWT token |
| POST | `/auth/logout` | No | Clear session cookie |

**Flow**:
1. `POST /auth/nonce` with `{ wallet_address }` → `{ nonce }`
2. User signs: `Heritage Splitter Authentication\n\nWallet: {address}\nNonce: {nonce}`
3. `POST /auth/verify` with `{ wallet_address, signature, message }` → `{ token, user_exists }`
4. Include `Authorization: Bearer {token}` on all subsequent requests

## Users

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/me` | Yes | Get current user profile |
| PUT | `/me` | Yes | Update profile (display_name, bio, avatar_url, role, artist_number) |
| GET | `/users` | Yes | Search users (query: `q`, `role`) |
| GET | `/users/{wallet}` | Yes | Get user by wallet address |

## Projects

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/projects` | Yes | Create a new project |
| GET | `/projects` | Yes | List user's projects |
| GET | `/projects/{id}` | Yes | Get project details |
| PUT | `/projects/{id}` | Yes | Update project |
| POST | `/projects/{id}/close` | Yes | Close project |
| POST | `/projects/{id}/reopen` | Yes | Reopen closed project |
| POST | `/projects/{id}/submit-for-approval` | Yes | Submit for participant approval |
| POST | `/projects/{id}/approve-terms` | Yes | Approve project terms |

## Participants

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/projects/{id}/participants` | Yes | Invite a participant |
| PUT | `/participants/{id}/accept` | Yes | Accept invitation |
| PUT | `/participants/{id}/reject` | Yes | Reject invitation |
| PUT | `/participants/{id}` | Yes | Update participant details |
| PUT | `/participants/{id}/kick` | Yes | Remove participant |

## Allocations

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/projects/{id}/allocations` | Yes | Create allocation category |
| GET | `/projects/{id}/allocations` | Yes | List allocations |
| PUT | `/allocations/{id}` | Yes | Update allocation |
| DELETE | `/allocations/{id}` | Yes | Delete allocation |
| POST | `/allocations/{id}/recompute` | Yes | Recompute shares |

## Collections

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/projects/{id}/collections` | Yes | Create collection |
| GET | `/projects/{id}/collections` | Yes | List project collections |
| GET | `/collections/{id}` | Yes | Get collection details (includes allocations, NFTs, drafts) |
| PUT | `/collections/{id}` | Yes | Update collection |
| DELETE | `/collections/{id}` | Yes | Delete collection |
| POST | `/collections/{id}/submit-for-approval` | Yes | Submit for approval |
| POST | `/collections/{id}/approve` | Yes | Approve collection |
| POST | `/collections/{id}/validate-approval` | Yes | Lock for deployment |
| POST | `/collections/{id}/deploy` | Yes | Deploy on-chain (mint + list) |
| POST | `/collections/{id}/mint` | Yes | Mint additional NFTs |
| POST | `/collections/{id}/publish` | Yes | Make collection public |
| POST | `/collections/{id}/unpublish` | Yes | Remove public access |

### Draft NFTs

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/collections/{id}/draft-nfts` | Yes | List draft NFTs |
| POST | `/collections/{id}/draft-nfts` | Yes | Create draft NFT |
| PUT | `/draft-nfts/{id}` | Yes | Update draft NFT |
| DELETE | `/draft-nfts/{id}` | Yes | Delete draft NFT |

### Minted NFTs

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/collections/{id}/nfts` | Yes | List minted NFTs |
| POST | `/collections/{id}/nfts/{token_id}/delist` | Yes | Remove from market |
| POST | `/collections/{id}/nfts/{token_id}/relist` | Yes | Re-list on market |

## Showrooms

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/showrooms` | Yes | Create showroom |
| GET | `/showrooms` | Yes | List user's showrooms |
| GET | `/showrooms/{id}` | Yes | Get showroom details |
| PUT | `/showrooms/{id}` | Yes | Update showroom |
| POST | `/showrooms/{id}/invite` | Yes | Invite artist |
| POST | `/showrooms/{id}/accept` | Yes | Accept invitation |
| DELETE | `/showrooms/{id}/participants/{userId}` | Yes | Remove participant |
| POST | `/showrooms/{id}/listings` | Yes | Create listing |
| POST | `/showrooms/{id}/propose-collection` | Yes | Propose entire collection |
| GET | `/showrooms/{id}/my-collections` | Yes | List proposable collections |
| PUT | `/showrooms/{id}/batch-margin` | Yes | Batch update margins |
| DELETE | `/showrooms/{id}/collections/{collectionId}` | Yes | Remove shared collection |
| POST | `/showrooms/{id}/deploy` | Yes | Deploy on-chain |
| POST | `/showrooms/{id}/publish` | Yes | Generate public URL |
| POST | `/showrooms/{id}/unpublish` | Yes | Remove public URL |

### Showroom Listings

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| PUT | `/showroom-listings/{id}` | Yes | Update listing (margin, status) |
| DELETE | `/showroom-listings/{id}` | Yes | Delete listing |

## Documents

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/projects/{id}/documents` | Yes | List project documents |
| POST | `/projects/{id}/documents` | Yes | Upload document (multipart, max 50MB) |
| GET | `/showrooms/{id}/documents` | Yes | List showroom documents |
| POST | `/showrooms/{id}/documents` | Yes | Upload showroom document |
| GET | `/documents/{id}/download` | Yes | Download decrypted document |
| POST | `/documents/{id}/certify` | Yes | Certify on-chain (EIP-712) |
| POST | `/documents/{id}/share` | Yes | Grant access to user |
| DELETE | `/documents/{id}/share/{userId}` | Yes | Revoke access |

## Discussions

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/projects/{id}/threads` | Yes | List discussion threads |
| POST | `/projects/{id}/threads` | Yes | Create thread |
| GET | `/threads/{id}/messages` | Yes | List thread messages |
| POST | `/threads/{id}/messages` | Yes | Post message |
| PUT | `/threads/{id}/resolve` | Yes | Resolve thread |
| PUT | `/threads/{id}/reopen` | Yes | Reopen thread |

## Direct Messages

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/dm/conversations` | Yes | List conversations |
| GET | `/dm/{userId}` | Yes | Get messages with user |
| POST | `/dm/{userId}` | Yes | Send message |

## Notifications

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/notifications` | Yes | List notifications |
| GET | `/notifications/unread-count` | Yes | Get unread count |
| PUT | `/notifications/{id}/read` | Yes | Mark as read |
| PUT | `/notifications/read-all` | Yes | Mark all as read |

## Images

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/images/upload` | Yes | Upload image (multipart: file + category) |
| GET | `/images/avatar/{userId}` | No | Get user avatar |
| GET | `/images/logo/{projectId}` | No | Get project logo |
| GET | `/images/storage/{*key}` | No | Get image by storage key |

Categories: `nft` (10MB), `logo` (10MB), `avatar` (2MB). Allowed types: PNG, JPEG, GIF, WebP.

## Public Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/public/projects` | No | List public projects |
| GET | `/public/projects/{id}` | No | Get public project |
| GET | `/public/collections/{slug}` | No | Get public collection |
| GET | `/public/collections/{id}/history` | No | Collection mint history |
| GET | `/public/showrooms/{slug}` | No | Get public showroom |
| GET | `/public/verify/{contract}/{tokenId}` | No | Verify NFT on-chain |
| GET | `/public/verify-document/{hash}` | No | Verify document certification |
| GET | `/metadata/{contract}/{tokenId}` | No | NFT metadata (JSON) |
| GET | `/documents/nonce/{wallet}` | No | Get certifier nonce |

## WebSocket

| Endpoint | Auth | Description |
|----------|------|-------------|
| GET `/ws` | First message | Real-time event stream |

Connect to `/api/ws`. Send `{"type":"auth","token":"..."}` as first message. Receive `{"type":"auth_ok"}` on success.

Event kinds: `notification`, `dm_received`, `invitation_received`, `thread_created`, `message_posted`, `approval_requested`

## Rate Limits

- **Authenticated endpoints**: 60 requests/minute per user
- **Auth endpoints**: 10 requests/minute per IP
- **WebSocket**: Rate limited per connection
- **Body size**: 2MB (standard), 50MB (document/image upload)
