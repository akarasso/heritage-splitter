#!/usr/bin/env bash
# Heritage Splitter — Initialisation de la BDD SQLite
# Usage: ./scripts/init-db.sh

set -euo pipefail

DB_PATH="${1:-backend/heritage.db}"

echo "🗄️  Création de la BDD: $DB_PATH"

# Supprimer l'ancienne BDD
rm -f "$DB_PATH" "${DB_PATH}-shm" "${DB_PATH}-wal"

sqlite3 "$DB_PATH" <<'SQL'
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    wallet_address TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'artist',
    bio TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    artist_number TEXT NOT NULL DEFAULT '',
    is_bot INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_nonces (
    wallet_address TEXT PRIMARY KEY,
    nonce TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
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
);

CREATE TABLE IF NOT EXISTS allocations (
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
);

CREATE TABLE IF NOT EXISTS participants (
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
);

CREATE TABLE IF NOT EXISTS nfts (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    token_id INTEGER NOT NULL,
    metadata_uri TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    artist_name TEXT NOT NULL DEFAULT '',
    phase TEXT NOT NULL DEFAULT 'primary',
    minted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    nft_id TEXT NOT NULL REFERENCES nfts(id),
    tx_type TEXT NOT NULL,
    amount_wei TEXT NOT NULL DEFAULT '0',
    from_address TEXT NOT NULL DEFAULT '',
    to_address TEXT NOT NULL DEFAULT '',
    tx_hash TEXT NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
SQL

echo "✅ BDD initialisée (7 tables)"
