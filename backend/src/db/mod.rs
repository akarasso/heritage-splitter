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
        "CREATE TABLE IF NOT EXISTS works (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            work_type TEXT NOT NULL DEFAULT 'nft_collection',
            status TEXT NOT NULL DEFAULT 'draft',
            royalty_bps INTEGER NOT NULL DEFAULT 1000,
            contract_nft_address TEXT,
            contract_splitter_address TEXT,
            completed_at DATETIME,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"
    ).execute(pool).await?;

    // Migration: add work_id to existing allocations and nfts tables
    let _ = sqlx::query("ALTER TABLE allocations ADD COLUMN work_id TEXT REFERENCES works(id)")
        .execute(pool).await;
    let _ = sqlx::query("ALTER TABLE nfts ADD COLUMN work_id TEXT REFERENCES works(id)")
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

    // Migration: add work_id to threads for per-work discussion filtering
    let _ = sqlx::query("ALTER TABLE threads ADD COLUMN work_id TEXT REFERENCES works(id)")
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

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS draft_nfts (
            id TEXT PRIMARY KEY,
            work_id TEXT NOT NULL REFERENCES works(id),
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

    // Migration: add vault, public_slug, is_public to works
    let _ = sqlx::query("ALTER TABLE works ADD COLUMN contract_vault_address TEXT")
        .execute(pool).await;
    let _ = sqlx::query("ALTER TABLE works ADD COLUMN public_slug TEXT")
        .execute(pool).await;
    let _ = sqlx::query("ALTER TABLE works ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0")
        .execute(pool).await;

    // Migration: add deploy_block_number to works
    let _ = sqlx::query("ALTER TABLE works ADD COLUMN deploy_block_number INTEGER")
        .execute(pool).await;

    // Cache table for on-chain events (avoid re-fetching from RPC)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS work_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            work_id TEXT NOT NULL REFERENCES works(id),
            event_type TEXT NOT NULL,
            block_number INTEGER NOT NULL,
            tx_hash TEXT NOT NULL,
            data TEXT NOT NULL DEFAULT '{}',
            UNIQUE(work_id, event_type, tx_hash, block_number)
        )"
    ).execute(pool).await?;

    // Track last scanned block per work
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS work_events_cursor (
            work_id TEXT PRIMARY KEY REFERENCES works(id),
            last_scanned_block INTEGER NOT NULL
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
        "CREATE INDEX IF NOT EXISTS idx_allocations_work_id ON allocations(work_id)",
        "CREATE INDEX IF NOT EXISTS idx_nfts_project_id ON nfts(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_nfts_work_id ON nfts(work_id)",
        "CREATE INDEX IF NOT EXISTS idx_threads_project_id ON threads(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id)",
        "CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read)",
        "CREATE INDEX IF NOT EXISTS idx_documents_project_id ON documents(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_documents_sha256_hash ON documents(sha256_hash)",
        "CREATE INDEX IF NOT EXISTS idx_document_access_document_id ON document_access(document_id)",
        "CREATE INDEX IF NOT EXISTS idx_works_project_id ON works(project_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_works_public_slug ON works(public_slug) WHERE public_slug IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS idx_draft_nfts_work_id ON draft_nfts(work_id)",
        "CREATE INDEX IF NOT EXISTS idx_work_events_work_id ON work_events(work_id)",
        "CREATE INDEX IF NOT EXISTS idx_direct_messages_sender ON direct_messages(sender_id)",
        "CREATE INDEX IF NOT EXISTS idx_direct_messages_recipient ON direct_messages(recipient_id)",
    ];
    for idx in indexes {
        sqlx::query(idx).execute(pool).await?;
    }

    // Seed demo data (only if empty)
    let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await?;

    if user_count == 0 {
        seed_demo_data(pool).await?;
    }

    Ok(())
}

async fn seed_demo_data(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    // ── Users (real wallets on Avalanche Fuji) ───────────────────────
    // Private keys stored in scripts/wallets.env — NOT in code
    let users = [
        ("u-producer-01", "0x2d641f4aa137787e3bd34b132bb21e54c437ef6f", "Pierre Durand",       "producer", "Contemporary art producer, specialized in limited editions."),
        ("u-artist-01",   "0x1bbc56f627b1e759afc79eec651a840ff8d09621", "Marie Lefevre",       "artist",   "Visual artist working with digital media and photography."),
        ("u-gallery-01",  "0x1c3ca0b7d45a4dcfe0e25f83b7731f523f564c38", "Galerie Rive Gauche", "gallery",  "Contemporary art gallery, Paris 6th arrondissement."),
    ];
    for (id, wallet, name, role, bio) in users {
        sqlx::query("INSERT OR IGNORE INTO users (id, wallet_address, display_name, role, bio, is_bot) VALUES (?, ?, ?, ?, ?, 1)")
            .bind(id).bind(wallet).bind(name).bind(role).bind(bio)
            .execute(pool).await?;
    }

    tracing::info!("Seeded 3 demo users with real Avalanche wallets");
    Ok(())
}
