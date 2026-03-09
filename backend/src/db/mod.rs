use sqlx::SqlitePool;

pub async fn run_migrations(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            wallet_address TEXT UNIQUE NOT NULL,
            display_name TEXT NOT NULL DEFAULT '',
            role TEXT NOT NULL DEFAULT 'artist',
            bio TEXT NOT NULL DEFAULT '',
            avatar_url TEXT NOT NULL DEFAULT '',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"
    ).execute(pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS auth_nonces (
            wallet_address TEXT PRIMARY KEY,
            nonce TEXT NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"
    ).execute(pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'draft',
            creator_id TEXT NOT NULL REFERENCES users(id),
            royalty_bps INTEGER NOT NULL DEFAULT 1000,
            contract_nft_address TEXT,
            contract_splitter_address TEXT,
            logo_url TEXT NOT NULL DEFAULT '',
            max_participants INTEGER,
            completed_at DATETIME,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"
    ).execute(pool).await?;

    // Migration: add new columns to existing projects table
    for col in &[
        "ALTER TABLE projects ADD COLUMN logo_url TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE projects ADD COLUMN max_participants INTEGER",
        "ALTER TABLE projects ADD COLUMN completed_at DATETIME",
    ] {
        let _ = sqlx::query(col).execute(pool).await;
    }

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS allocations (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            role TEXT NOT NULL,
            label TEXT NOT NULL DEFAULT '',
            total_bps INTEGER NOT NULL,
            max_slots INTEGER,
            distribution_mode TEXT NOT NULL DEFAULT 'equal',
            sort_order INTEGER NOT NULL DEFAULT 0,
            receives_primary INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"
    ).execute(pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS participants (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            user_id TEXT REFERENCES users(id),
            wallet_address TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'artist',
            shares_bps INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'invited',
            allocation_id TEXT REFERENCES allocations(id),
            invited_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            accepted_at DATETIME
        )"
    ).execute(pool).await?;

    // Migration: add allocation_id to existing participants table
    let _ = sqlx::query("ALTER TABLE participants ADD COLUMN allocation_id TEXT REFERENCES allocations(id)")
        .execute(pool).await;

    // Migration: add receives_primary to allocations
    let _ = sqlx::query("ALTER TABLE allocations ADD COLUMN receives_primary INTEGER NOT NULL DEFAULT 0")
        .execute(pool).await;

    // Migration: add approved_at to participants (approval workflow)
    let _ = sqlx::query("ALTER TABLE participants ADD COLUMN approved_at DATETIME")
        .execute(pool).await;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS threads (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            author_id TEXT NOT NULL REFERENCES users(id),
            title TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'open',
            conclusion TEXT,
            concluded_by TEXT REFERENCES users(id),
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"
    ).execute(pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            thread_id TEXT NOT NULL REFERENCES threads(id),
            user_id TEXT NOT NULL REFERENCES users(id),
            content TEXT NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"
    ).execute(pool).await?;

    // Migration: add thread_id to existing messages
    let _ = sqlx::query("ALTER TABLE messages ADD COLUMN thread_id TEXT REFERENCES threads(id)")
        .execute(pool).await;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS nfts (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            token_id INTEGER NOT NULL,
            metadata_uri TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            artist_name TEXT NOT NULL DEFAULT '',
            phase TEXT NOT NULL DEFAULT 'primary',
            minted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"
    ).execute(pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS transactions (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            nft_id TEXT NOT NULL REFERENCES nfts(id),
            tx_type TEXT NOT NULL,
            amount_wei TEXT NOT NULL DEFAULT '0',
            from_address TEXT NOT NULL DEFAULT '',
            to_address TEXT NOT NULL DEFAULT '',
            tx_hash TEXT NOT NULL DEFAULT '',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"
    ).execute(pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id),
            kind TEXT NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL DEFAULT '',
            project_id TEXT REFERENCES projects(id),
            reference_id TEXT,
            is_read INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"
    ).execute(pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            uploader_id TEXT NOT NULL REFERENCES users(id),
            original_name TEXT NOT NULL,
            mime_type TEXT NOT NULL DEFAULT '',
            file_size INTEGER NOT NULL DEFAULT 0,
            stored_path TEXT NOT NULL,
            sha256_hash TEXT NOT NULL,
            encryption_key TEXT NOT NULL,
            encryption_iv TEXT NOT NULL,
            tx_hash TEXT,
            certified_at DATETIME,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"
    ).execute(pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS document_access (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL REFERENCES documents(id),
            user_id TEXT NOT NULL REFERENCES users(id),
            granted_by TEXT NOT NULL REFERENCES users(id),
            granted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(document_id, user_id)
        )"
    ).execute(pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS collections (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            collection_type TEXT NOT NULL DEFAULT 'nft_collection',
            status TEXT NOT NULL DEFAULT 'draft',
            royalty_bps INTEGER NOT NULL DEFAULT 1000,
            contract_nft_address TEXT,
            contract_splitter_address TEXT,
            completed_at DATETIME,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"
    ).execute(pool).await?;

    // Migration: add collection_id to existing allocations and nfts tables
    let _ = sqlx::query("ALTER TABLE allocations ADD COLUMN collection_id TEXT REFERENCES collections(id)")
        .execute(pool).await;
    let _ = sqlx::query("ALTER TABLE nfts ADD COLUMN collection_id TEXT REFERENCES collections(id)")
        .execute(pool).await;

    // Migration: add artist_number to users
    let _ = sqlx::query("ALTER TABLE users ADD COLUMN artist_number TEXT NOT NULL DEFAULT ''")
        .execute(pool).await;

    // Migration: add is_bot to users
    let _ = sqlx::query("ALTER TABLE users ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0")
        .execute(pool).await;

    // Migration: add certified_by to documents
    let _ = sqlx::query("ALTER TABLE documents ADD COLUMN certified_by TEXT")
        .execute(pool).await;

    // Migration: add collection_id to threads for per-collection discussion filtering
    let _ = sqlx::query("ALTER TABLE threads ADD COLUMN collection_id TEXT REFERENCES collections(id)")
        .execute(pool).await;

    // Migration: add description, image_url, price, attributes to nfts
    let _ = sqlx::query("ALTER TABLE nfts ADD COLUMN description TEXT NOT NULL DEFAULT ''")
        .execute(pool).await;
    let _ = sqlx::query("ALTER TABLE nfts ADD COLUMN image_url TEXT NOT NULL DEFAULT ''")
        .execute(pool).await;
    let _ = sqlx::query("ALTER TABLE nfts ADD COLUMN price TEXT NOT NULL DEFAULT ''")
        .execute(pool).await;
    let _ = sqlx::query("ALTER TABLE nfts ADD COLUMN attributes TEXT NOT NULL DEFAULT '[]'")
        .execute(pool).await;

    // Migration: add showroom_id to documents for showroom document support
    let _ = sqlx::query("ALTER TABLE documents ADD COLUMN showroom_id TEXT REFERENCES showrooms(id)")
        .execute(pool).await;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS draft_nfts (
            id TEXT PRIMARY KEY,
            collection_id TEXT NOT NULL REFERENCES collections(id),
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            artist_name TEXT NOT NULL DEFAULT '',
            price TEXT NOT NULL DEFAULT '',
            image_url TEXT NOT NULL DEFAULT '',
            metadata_uri TEXT NOT NULL DEFAULT '',
            attributes TEXT NOT NULL DEFAULT '[]',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"
    ).execute(pool).await?;

    // Migration: add market, public_slug, is_public to collections
    let _ = sqlx::query("ALTER TABLE collections ADD COLUMN contract_market_address TEXT")
        .execute(pool).await;
    let _ = sqlx::query("ALTER TABLE collections ADD COLUMN public_slug TEXT")
        .execute(pool).await;
    let _ = sqlx::query("ALTER TABLE collections ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0")
        .execute(pool).await;

    // Migration: add deploy_block_number to collections
    let _ = sqlx::query("ALTER TABLE collections ADD COLUMN deploy_block_number INTEGER")
        .execute(pool).await;

    // Cache table for on-chain events (avoid re-fetching from RPC)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS collection_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            collection_id TEXT NOT NULL REFERENCES collections(id),
            event_type TEXT NOT NULL,
            block_number INTEGER NOT NULL,
            tx_hash TEXT NOT NULL,
            data TEXT NOT NULL DEFAULT '{}',
            UNIQUE(collection_id, event_type, tx_hash, block_number)
        )"
    ).execute(pool).await?;

    // Track last scanned block per collection
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS collection_events_cursor (
            collection_id TEXT PRIMARY KEY REFERENCES collections(id),
            last_scanned_block INTEGER NOT NULL
        )"
    ).execute(pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS showrooms (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'draft',
            creator_id TEXT NOT NULL REFERENCES users(id),
            contract_address TEXT,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"
    ).execute(pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS showroom_participants (
            id TEXT PRIMARY KEY,
            showroom_id TEXT NOT NULL REFERENCES showrooms(id),
            user_id TEXT NOT NULL REFERENCES users(id),
            status TEXT NOT NULL DEFAULT 'invited',
            invited_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            accepted_at DATETIME,
            UNIQUE(showroom_id, user_id)
        )"
    ).execute(pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS showroom_listings (
            id TEXT PRIMARY KEY,
            showroom_id TEXT NOT NULL REFERENCES showrooms(id),
            nft_contract TEXT NOT NULL,
            token_id INTEGER NOT NULL,
            base_price TEXT NOT NULL DEFAULT '0',
            margin TEXT NOT NULL DEFAULT '0',
            proposed_by TEXT NOT NULL REFERENCES users(id),
            status TEXT NOT NULL DEFAULT 'proposed',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"
    ).execute(pool).await?;

    // Migration: add NFT details to showroom_listings
    let _ = sqlx::query("ALTER TABLE showroom_listings ADD COLUMN title TEXT NOT NULL DEFAULT ''")
        .execute(pool).await;
    let _ = sqlx::query("ALTER TABLE showroom_listings ADD COLUMN image_url TEXT NOT NULL DEFAULT ''")
        .execute(pool).await;
    let _ = sqlx::query("ALTER TABLE showroom_listings ADD COLUMN artist_name TEXT NOT NULL DEFAULT ''")
        .execute(pool).await;
    let _ = sqlx::query("ALTER TABLE showroom_listings ADD COLUMN collection_id TEXT")
        .execute(pool).await;
    let _ = sqlx::query("ALTER TABLE showroom_listings ADD COLUMN collection_name TEXT NOT NULL DEFAULT ''")
        .execute(pool).await;

    // Migration: add public_slug, is_public to showrooms
    let _ = sqlx::query("ALTER TABLE showrooms ADD COLUMN public_slug TEXT")
        .execute(pool).await;
    let _ = sqlx::query("ALTER TABLE showrooms ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0")
        .execute(pool).await;

    // Migration: add showroom_item_id to showroom_listings
    let _ = sqlx::query("ALTER TABLE showroom_listings ADD COLUMN showroom_item_id INTEGER")
        .execute(pool).await;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS audit_logs (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            action TEXT NOT NULL,
            resource_type TEXT NOT NULL,
            resource_id TEXT NOT NULL DEFAULT '',
            details TEXT NOT NULL DEFAULT '{}',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"
    ).execute(pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS direct_messages (
            id TEXT PRIMARY KEY,
            sender_id TEXT NOT NULL REFERENCES users(id),
            recipient_id TEXT NOT NULL REFERENCES users(id),
            content TEXT NOT NULL,
            is_read INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"
    ).execute(pool).await?;

    // ── Indexes for query performance ──────────────────────────────────
    let indexes = [
        "CREATE INDEX IF NOT EXISTS idx_projects_creator_id ON projects(creator_id)",
        "CREATE INDEX IF NOT EXISTS idx_participants_project_id ON participants(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_participants_wallet_address ON participants(wallet_address)",
        "CREATE INDEX IF NOT EXISTS idx_participants_allocation_id ON participants(allocation_id)",
        "CREATE INDEX IF NOT EXISTS idx_participants_user_id ON participants(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_allocations_project_id ON allocations(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_allocations_collection_id ON allocations(collection_id)",
        "CREATE INDEX IF NOT EXISTS idx_nfts_project_id ON nfts(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_nfts_collection_id ON nfts(collection_id)",
        "CREATE INDEX IF NOT EXISTS idx_threads_project_id ON threads(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id)",
        "CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read)",
        "CREATE INDEX IF NOT EXISTS idx_documents_project_id ON documents(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_documents_sha256_hash ON documents(sha256_hash)",
        "CREATE INDEX IF NOT EXISTS idx_document_access_document_id ON document_access(document_id)",
        "CREATE INDEX IF NOT EXISTS idx_collections_project_id ON collections(project_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_public_slug ON collections(public_slug) WHERE public_slug IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS idx_draft_nfts_collection_id ON draft_nfts(collection_id)",
        "CREATE INDEX IF NOT EXISTS idx_collection_events_collection_id ON collection_events(collection_id)",
        "CREATE INDEX IF NOT EXISTS idx_direct_messages_sender ON direct_messages(sender_id)",
        "CREATE INDEX IF NOT EXISTS idx_direct_messages_recipient ON direct_messages(recipient_id)",
        "CREATE INDEX IF NOT EXISTS idx_showrooms_creator_id ON showrooms(creator_id)",
        "CREATE INDEX IF NOT EXISTS idx_showroom_participants_showroom_id ON showroom_participants(showroom_id)",
        "CREATE INDEX IF NOT EXISTS idx_showroom_participants_user_id ON showroom_participants(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_showroom_listings_showroom_id ON showroom_listings(showroom_id)",
        "CREATE INDEX IF NOT EXISTS idx_documents_showroom_id ON documents(showroom_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_showrooms_public_slug ON showrooms(public_slug) WHERE public_slug IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id)",
    ];
    for idx in indexes {
        sqlx::query(idx).execute(pool).await?;
    }

    Ok(())
}
