# Database Schema

SQLite database with 18 tables. All IDs are UUIDs (TEXT). Timestamps are stored as TEXT (ISO 8601).

## Entity Relationship

```
users ─────┬──► projects ──────┬──► collections ──────┬──► draft_nfts
           │        │          │        │              └──► nfts
           │        │          │        │
           │        ├──► participants   ├──► allocations
           │        │                   │
           │        ├──► threads ──► messages
           │        │
           │        └──► documents ──► document_access
           │
           ├──► showrooms ──┬──► showroom_participants
           │                ├──► showroom_listings
           │                └──► documents
           │
           ├──► notifications
           ├──► direct_messages
           └──► audit_logs
```

## Core Tables

### users
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| wallet_address | TEXT UNIQUE | Ethereum address (lowercase) |
| display_name | TEXT | Public display name |
| role | TEXT | "artist" or "producer" |
| bio | TEXT | User biography |
| avatar_url | TEXT | MinIO storage key or data URI |
| artist_number | TEXT | Artist registration number (artists only) |
| is_bot | BOOLEAN | Legacy bot flag |
| created_at | DATETIME | Registration timestamp |

### projects
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| creator_id | TEXT FK→users | Project owner |
| name | TEXT | Project name |
| description | TEXT | Project description |
| status | TEXT | draft, active, pending_approval, approved, closed |
| royalty_bps | INTEGER | Default royalty basis points |
| logo_url | TEXT | MinIO storage key |
| max_participants | INTEGER | Maximum allowed participants |
| contract_nft_address | TEXT | Deployed NFT contract (if any) |
| contract_splitter_address | TEXT | Deployed splitter contract (if any) |
| created_at | DATETIME | |
| completed_at | DATETIME | |

### collections
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| project_id | TEXT FK→projects | Parent project |
| name | TEXT | Collection name |
| description | TEXT | |
| collection_type | TEXT | "nft_collection" |
| status | TEXT | draft → pending_approval → approved → ready_to_deploy → deployed |
| royalty_bps | INTEGER | Royalty basis points for ERC-2981 |
| contract_nft_address | TEXT | Deployed CollectionNFT address |
| contract_splitter_address | TEXT | Deployed ArtistsSplitter address |
| contract_market_address | TEXT | Associated NFTMarket address |
| public_slug | TEXT | URL slug for public access |
| is_public | BOOLEAN | Whether publicly visible |
| deploy_block_number | INTEGER | Block number at deployment |
| created_at | DATETIME | |
| completed_at | DATETIME | |

### allocations
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| project_id | TEXT FK→projects | |
| collection_id | TEXT FK→collections | |
| role | TEXT | Allocation category name |
| label | TEXT | Display label |
| total_bps | INTEGER | Total basis points for this category |
| max_slots | INTEGER | Maximum participant slots |
| distribution_mode | TEXT | How shares are split within category |
| sort_order | INTEGER | Display order |
| receives_primary | BOOLEAN | Receives primary sale revenue |

### participants
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| project_id | TEXT FK→projects | |
| user_id | TEXT FK→users | |
| wallet_address | TEXT | Participant's wallet for on-chain split |
| role | TEXT | Role within project |
| shares_bps | INTEGER | Individual share in basis points |
| status | TEXT | invited, accepted, approved, kicked |
| allocation_id | TEXT FK→allocations | Assigned allocation slot |
| invited_at | DATETIME | |
| accepted_at | DATETIME | |
| approved_at | DATETIME | |

## NFT Tables

### draft_nfts
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| collection_id | TEXT FK→collections | |
| title | TEXT | NFT title |
| description | TEXT | NFT description |
| artist_name | TEXT | Creator name |
| price | TEXT | Price in AVAX (decimal string) |
| image_url | TEXT | MinIO storage key |
| metadata_uri | TEXT | On-chain metadata URI |
| attributes | TEXT | JSON array of {trait_type, value} |
| created_at | DATETIME | |

### nfts
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| project_id | TEXT FK→projects | |
| collection_id | TEXT FK→collections | |
| token_id | INTEGER | On-chain token ID |
| metadata_uri | TEXT | On-chain metadata URI |
| title | TEXT | |
| artist_name | TEXT | |
| description | TEXT | |
| image_url | TEXT | MinIO storage key |
| price | TEXT | Price in AVAX |
| attributes | TEXT | JSON array |
| phase | TEXT | "primary" |
| minted_at | DATETIME | |

## Showroom Tables

### showrooms
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| creator_id | TEXT FK→users | Producer who owns the showroom |
| name | TEXT | Showroom name |
| description | TEXT | |
| status | TEXT | draft, active, deployed, published |
| contract_address | TEXT | Deployed Showroom contract |
| public_slug | TEXT UNIQUE | URL slug for public sale page |
| is_public | BOOLEAN | Whether sale page is active |
| created_at | DATETIME | |

### showroom_participants
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| showroom_id | TEXT FK→showrooms | |
| user_id | TEXT FK→users | Invited artist |
| status | TEXT | invited, accepted |
| invited_at | DATETIME | |
| accepted_at | DATETIME | |

### showroom_listings
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| showroom_id | TEXT FK→showrooms | |
| nft_contract | TEXT | CollectionNFT address |
| token_id | INTEGER | On-chain token ID |
| base_price | TEXT | Price in wei |
| margin | TEXT | Producer margin in wei |
| proposed_by | TEXT FK→users | Artist who proposed |
| status | TEXT | proposed, active |
| title | TEXT | NFT title |
| image_url | TEXT | MinIO storage key |
| artist_name | TEXT | |
| collection_id | TEXT FK→collections | Source collection |
| collection_name | TEXT | "ProjectName - CollectionName" |
| showroom_item_id | INTEGER | On-chain item index |
| created_at | DATETIME | |

## Communication Tables

### threads
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| project_id | TEXT FK→projects | |
| collection_id | TEXT FK→collections | Optional, collection-specific thread |
| author_id | TEXT FK→users | Thread creator |
| title | TEXT | Thread title |
| status | TEXT | open, closed |
| conclusion | TEXT | Resolution summary |
| concluded_by | TEXT FK→users | Who resolved it |
| created_at | DATETIME | |

### messages
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| thread_id | TEXT FK→threads | |
| project_id | TEXT FK→projects | |
| user_id | TEXT FK→users | Message author |
| content | TEXT | Message content |
| created_at | DATETIME | |

### direct_messages
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| sender_id | TEXT FK→users | |
| recipient_id | TEXT FK→users | |
| content | TEXT | |
| is_read | BOOLEAN | |
| created_at | DATETIME | |

## Document Tables

### documents
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| project_id | TEXT FK→projects | Optional |
| showroom_id | TEXT FK→showrooms | Optional |
| uploader_id | TEXT FK→users | |
| original_name | TEXT | Original filename |
| mime_type | TEXT | |
| file_size | INTEGER | Size in bytes |
| stored_path | TEXT | MinIO storage path |
| sha256_hash | TEXT | SHA-256 hex hash |
| encryption_key | TEXT | AES-256-GCM key (base64) |
| encryption_iv | TEXT | AES-256-GCM IV (base64) |
| tx_hash | TEXT | Certification transaction hash |
| certified_at | DATETIME | On-chain certification timestamp |
| certified_by | TEXT | Certifier wallet address |
| created_at | DATETIME | |

### document_access
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| document_id | TEXT FK→documents | |
| user_id | TEXT FK→users | Granted to |
| granted_by | TEXT FK→users | Granted by |
| granted_at | DATETIME | |

## System Tables

### notifications
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| user_id | TEXT FK→users | Recipient |
| project_id | TEXT FK→projects | Optional context |
| kind | TEXT | notification type |
| title | TEXT | |
| body | TEXT | |
| reference_id | TEXT | Related entity ID |
| is_read | BOOLEAN | |
| created_at | DATETIME | |

### audit_logs
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| user_id | TEXT | Actor |
| action | TEXT | Action performed |
| resource_type | TEXT | Entity type |
| resource_id | TEXT | Entity ID |
| details | TEXT | JSON metadata |
| created_at | DATETIME | |

### auth_nonces
| Column | Type | Description |
|--------|------|-------------|
| wallet_address | TEXT PK | |
| nonce | TEXT | Random nonce for signing |
| created_at | DATETIME | |

## Indexes

30+ indexes on frequently queried columns including: `project_id`, `collection_id`, `user_id`, `wallet_address`, `thread_id`, `showroom_id`, `status`, `is_read`, `public_slug`.
