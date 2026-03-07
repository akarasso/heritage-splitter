use axum::{extract::{State, Path, Query}, Json};
use axum::http::{header, StatusCode};
use axum::response::IntoResponse;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::models::{Project, Participant, Nft, Allocation, Work};
use crate::services::blockchain;
use crate::AppState;

/// Public-safe participant representation — no wallet_address exposed
#[derive(Serialize, utoipa::ToSchema)]
pub struct PublicParticipant {
    pub id: String,
    pub project_id: String,
    pub user_id: Option<String>,
    pub role: String,
    pub shares_bps: i64,
    pub status: String,
    pub allocation_id: Option<String>,
}

impl From<Participant> for PublicParticipant {
    fn from(p: Participant) -> Self {
        Self {
            id: p.id,
            project_id: p.project_id,
            user_id: p.user_id,
            role: p.role,
            shares_bps: p.shares_bps,
            status: p.status,
            allocation_id: p.allocation_id,
        }
    }
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct VerifyResponse {
    pub nft: Nft,
    pub project: Project,
    pub participants: Vec<PublicParticipant>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct PublicAllocation {
    #[serde(flatten)]
    pub allocation: Allocation,
    pub filled_slots: i64,
    pub open_slots: Option<i64>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct PublicProject {
    #[serde(flatten)]
    pub project: Project,
    pub participants: Vec<PublicParticipant>,
    pub allocations: Vec<PublicAllocation>,
    pub participant_count: i64,
    pub nft_count: i64,
    pub creator_name: String,
}

#[derive(Deserialize)]
pub struct ProjectListQuery {
    pub status: Option<String>,
}

async fn build_public_project(pool: &SqlitePool, project: Project) -> Result<PublicProject, sqlx::Error> {
    let raw_participants: Vec<Participant> = sqlx::query_as(
        "SELECT * FROM participants WHERE project_id = ? LIMIT 500"
    )
    .bind(&project.id)
    .fetch_all(pool)
    .await?;

    let participant_count = raw_participants.len() as i64;
    let participants: Vec<PublicParticipant> = raw_participants.into_iter().map(PublicParticipant::from).collect();

    let nft_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM nfts WHERE project_id = ?"
    )
    .bind(&project.id)
    .fetch_one(pool)
    .await?;

    let creator_name: String = sqlx::query_scalar(
        "SELECT display_name FROM users WHERE id = ?"
    )
    .bind(&project.creator_id)
    .fetch_optional(pool)
    .await?
    .unwrap_or_default();

    // Build allocations with open slots info (single JOIN instead of N+1)
    let allocs: Vec<Allocation> = sqlx::query_as(
        "SELECT * FROM allocations WHERE project_id = ? ORDER BY sort_order, created_at LIMIT 200"
    )
    .bind(&project.id)
    .fetch_all(pool)
    .await?;

    let alloc_counts: Vec<(String, i64)> = sqlx::query_as(
        "SELECT allocation_id, COUNT(*) FROM participants
         WHERE project_id = ? AND allocation_id IS NOT NULL AND status != 'rejected'
         GROUP BY allocation_id LIMIT 200"
    )
    .bind(&project.id)
    .fetch_all(pool)
    .await?;

    let mut allocations = Vec::new();
    for alloc in allocs {
        let filled = alloc_counts.iter()
            .find(|(aid, _)| aid == &alloc.id)
            .map(|(_, c)| *c)
            .unwrap_or(0);

        let open = alloc.max_slots.map(|max| (max - filled).max(0));

        allocations.push(PublicAllocation {
            allocation: alloc,
            filled_slots: filled,
            open_slots: open,
        });
    }

    Ok(PublicProject {
        project,
        participants,
        allocations,
        participant_count,
        nft_count,
        creator_name,
    })
}

pub async fn list_public_projects(
    State(state): State<AppState>,
    Query(params): Query<ProjectListQuery>,
) -> AppResult<Json<Vec<PublicProject>>> {
    let projects: Vec<Project> = match &params.status {
        Some(status) => {
            const VALID_PROJECT_STATUSES: &[&str] = &["draft", "active", "pending_approval", "approved", "closed"];
            if !VALID_PROJECT_STATUSES.contains(&status.as_str()) {
                return Err(AppError::BadRequest("Invalid project status filter".into()));
            }
            sqlx::query_as(
                "SELECT * FROM projects WHERE status = ? ORDER BY created_at DESC LIMIT 100"
            )
            .bind(status)
            .fetch_all(&state.pool)
            .await?
        }
        None => {
            sqlx::query_as(
                "SELECT * FROM projects ORDER BY created_at DESC LIMIT 100"
            )
            .fetch_all(&state.pool)
            .await?
        }
    };

    let mut result = Vec::new();
    for project in projects {
        result.push(build_public_project(&state.pool, project).await?);
    }

    Ok(Json(result))
}

pub async fn verify_nft(
    State(state): State<AppState>,
    Path((contract, token_id)): Path<(String, i64)>,
) -> AppResult<Json<VerifyResponse>> {
    // Look up by work contract address (works hold the deployed contracts, not projects)
    let work: Work = sqlx::query_as(
        "SELECT * FROM works WHERE contract_nft_address = ?"
    )
    .bind(&contract)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Contract not found".into()))?;

    let project: Project = sqlx::query_as(
        "SELECT * FROM projects WHERE id = ?"
    )
    .bind(&work.project_id)
    .fetch_one(&state.pool)
    .await?;

    let nft: Nft = sqlx::query_as(
        "SELECT * FROM nfts WHERE work_id = ? AND token_id = ?"
    )
    .bind(&work.id)
    .bind(token_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("NFT not found".into()))?;

    let raw_participants: Vec<Participant> = sqlx::query_as(
        "SELECT * FROM participants WHERE project_id = ? LIMIT 500"
    )
    .bind(&project.id)
    .fetch_all(&state.pool)
    .await?;

    let participants: Vec<PublicParticipant> = raw_participants.into_iter().map(PublicParticipant::from).collect();

    Ok(Json(VerifyResponse { nft, project, participants }))
}

pub async fn get_public_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<PublicProject>> {
    let project: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".into()))?;

    let result = build_public_project(&state.pool, project).await?;
    Ok(Json(result))
}

// ── Public collection (by slug, no auth) ───────────────────────────

#[derive(Serialize, utoipa::ToSchema)]
pub struct PublicBeneficiary {
    pub wallet_address: String,
    pub role: String,
    pub label: String,
    pub shares_bps: i64,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct PublicCollectionNft {
    pub token_id: i64,
    pub title: String,
    pub description: String,
    pub image_url: String,
    pub price: String,
    pub attributes: String,
    pub metadata_uri: String,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct PublicCollection {
    pub name: String,
    pub description: String,
    pub work_type: String,
    pub contract_nft_address: Option<String>,
    pub contract_splitter_address: Option<String>,
    pub contract_vault_address: Option<String>,
    pub public_slug: Option<String>,
    pub nfts: Vec<PublicCollectionNft>,
    pub total_nfts: usize,
    pub beneficiaries: Vec<PublicBeneficiary>,
}

// GET /api/public/collections/{slug}
pub async fn get_public_collection(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> AppResult<Json<PublicCollection>> {
    let work: Work = sqlx::query_as(
        "SELECT * FROM works WHERE public_slug = ? AND is_public = 1"
    )
    .bind(&slug)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Collection not found".into()))?;

    // Minted NFTs
    let nfts: Vec<Nft> = sqlx::query_as(
        "SELECT * FROM nfts WHERE work_id = ? ORDER BY token_id LIMIT 1000"
    )
    .bind(&work.id)
    .fetch_all(&state.pool)
    .await?;

    // Draft NFTs (to know total collection size)
    let draft_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM draft_nfts WHERE work_id = ?"
    )
    .bind(&work.id)
    .fetch_one(&state.pool)
    .await?;

    let total_nfts = nfts.len() + draft_count as usize;

    let collection_nfts: Vec<PublicCollectionNft> = nfts.iter().map(|n| PublicCollectionNft {
        token_id: n.token_id,
        title: n.title.clone(),
        description: n.description.clone(),
        image_url: n.image_url.clone(),
        price: n.price.clone(),
        attributes: n.attributes.clone(),
        metadata_uri: n.metadata_uri.clone(),
    }).collect();

    // Allocations + participants → beneficiaries (single JOIN query)
    let beneficiary_rows: Vec<(String, String, String, i64)> = sqlx::query_as(
        "SELECT p.wallet_address, a.role, a.label, p.shares_bps
         FROM participants p
         INNER JOIN allocations a ON p.allocation_id = a.id
         WHERE a.work_id = ? AND p.status NOT IN ('rejected', 'kicked')
         ORDER BY a.sort_order LIMIT 500"
    )
    .bind(&work.id)
    .fetch_all(&state.pool)
    .await?;

    let beneficiaries: Vec<PublicBeneficiary> = beneficiary_rows.into_iter().map(|(wallet, role, label, bps)| {
        PublicBeneficiary { wallet_address: wallet, role, label, shares_bps: bps }
    }).collect();

    Ok(Json(PublicCollection {
        name: work.name,
        description: work.description,
        work_type: work.work_type,
        contract_nft_address: work.contract_nft_address,
        contract_splitter_address: work.contract_splitter_address,
        contract_vault_address: work.contract_vault_address,
        public_slug: work.public_slug,
        nfts: collection_nfts,
        total_nfts,
        beneficiaries,
    }))
}

// ── OpenSea-compatible NFT metadata ─────────────────────────────────

#[derive(Serialize)]
struct OpenSeaTrait {
    trait_type: String,
    value: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_type: Option<String>,
}

#[derive(Serialize)]
struct OpenSeaMetadata {
    name: String,
    description: String,
    image: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    external_url: Option<String>,
    attributes: Vec<OpenSeaTrait>,
}

// GET /api/metadata/{contract}/{tokenId}
pub async fn nft_metadata(
    State(state): State<AppState>,
    Path((contract, token_id)): Path<(String, i64)>,
) -> Result<impl IntoResponse, AppError> {
    // Find the work by NFT contract address
    let work: Work = sqlx::query_as(
        "SELECT * FROM works WHERE contract_nft_address = ?"
    )
    .bind(&contract)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Contract not found".into()))?;

    // Find the NFT
    let nft: Nft = sqlx::query_as(
        "SELECT * FROM nfts WHERE work_id = ? AND token_id = ?"
    )
    .bind(&work.id)
    .bind(token_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("NFT not found".into()))?;

    // Parse attributes: DB stores [{"key":"X","value":"Y"}] or [{"trait_type":"X","value":"Y"}]
    let attributes = parse_opensea_attributes(&nft.attributes);

    let base_url = state.config.base_url.trim_end_matches('/');
    let external_url = format!("{}/verify/{}/{}", base_url, contract, token_id);

    // If image is a data URI, serve it via our image endpoint instead
    let image = if nft.image_url.starts_with("data:") {
        format!("{}/api/images/nft/{}", base_url, nft.id)
    } else {
        nft.image_url
    };

    let metadata = OpenSeaMetadata {
        name: nft.title,
        description: nft.description,
        image,
        external_url: Some(external_url),
        attributes,
    };

    let json = serde_json::to_string(&metadata)
        .map_err(|e| AppError::Internal(format!("JSON serialization error: {}", e)))?;

    Ok((
        [(header::CONTENT_TYPE, "application/json")],
        json,
    ))
}

// GET /api/images/nft/{nftId}
pub async fn nft_image(
    State(state): State<AppState>,
    Path(nft_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let image_url: String = sqlx::query_scalar(
        "SELECT image_url FROM nfts WHERE id = ?"
    )
    .bind(&nft_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("NFT not found".into()))?;

    // Parse data URI: data:image/png;base64,AAAA...
    let data_uri = image_url.strip_prefix("data:")
        .ok_or_else(|| AppError::NotFound("No embedded image".into()))?;

    let (mime, b64) = data_uri.split_once(",")
        .ok_or_else(|| AppError::Internal("Invalid data URI format".into()))?;

    let content_type = mime.split(';').next().unwrap_or("image/png");
    let content_type = match content_type {
        "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml" => content_type.to_string(),
        _ => "application/octet-stream".to_string(),
    };

    let bytes = base64::engine::general_purpose::STANDARD.decode(b64)
        .map_err(|e| AppError::Internal(format!("Base64 decode error: {}", e)))?;

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, "public, max-age=31536000, immutable".into()),
        ],
        bytes,
    ))
}

// GET /api/public/works/{workId}/history — on-chain event history for a collection
// Uses DB cache + incremental scan from last cursor position.
pub async fn work_history(
    State(state): State<AppState>,
    Path(work_id): Path<String>,
) -> AppResult<Json<blockchain::TokenHistory>> {
    let work: Work = sqlx::query_as("SELECT * FROM works WHERE id = ?")
        .bind(&work_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Work not found".into()))?;

    let nft_address = work.contract_nft_address.as_deref()
        .ok_or_else(|| AppError::BadRequest("Collection not deployed yet".into()))?;
    let vault_address = work.contract_vault_address.as_deref()
        .ok_or_else(|| AppError::BadRequest("No vault address".into()))?;
    let splitter_address = work.contract_splitter_address.as_deref()
        .ok_or_else(|| AppError::BadRequest("No splitter address".into()))?;

    let deploy_block = match work.deploy_block_number {
        Some(b) => b as u64,
        None => {
            // Legacy deploy without block tracking — no history available
            return Ok(Json(blockchain::TokenHistory {
                transfers: vec![], purchases: vec![], payments: vec![],
                total_revenue_wei: "0".into(),
            }));
        }
    };

    // Read cursor: last scanned block for this work
    let cursor: Option<i64> = sqlx::query_scalar(
        "SELECT last_scanned_block FROM work_events_cursor WHERE work_id = ?"
    )
    .bind(&work_id)
    .fetch_optional(&state.pool)
    .await?;

    // Scan from (cursor + 1) or deploy_block
    let scan_from = match cursor {
        Some(c) => (c as u64) + 1,
        None => deploy_block,
    };

    // Fetch new events from chain
    let scan = blockchain::fetch_collection_events(
        &state.config.avalanche_rpc_url,
        nft_address,
        vault_address,
        splitter_address,
        scan_from,
    ).await.map_err(|e| AppError::Internal(format!("Failed to fetch on-chain history: {}", e)))?;

    // Store new events in cache
    for t in &scan.transfers {
        let data = serde_json::json!({
            "from": t.from, "to": t.to, "token_id": t.token_id
        });
        let _ = sqlx::query(
            "INSERT OR IGNORE INTO work_events (work_id, event_type, block_number, tx_hash, data) VALUES (?, 'transfer', ?, ?, ?)"
        )
        .bind(&work_id).bind(t.block_number as i64).bind(&t.tx_hash).bind(data.to_string())
        .execute(&state.pool).await;
    }
    for p in &scan.purchases {
        let data = serde_json::json!({
            "token_id": p.token_id, "buyer": p.buyer, "price_wei": p.price_wei
        });
        let _ = sqlx::query(
            "INSERT OR IGNORE INTO work_events (work_id, event_type, block_number, tx_hash, data) VALUES (?, 'purchase', ?, ?, ?)"
        )
        .bind(&work_id).bind(p.block_number as i64).bind(&p.tx_hash).bind(data.to_string())
        .execute(&state.pool).await;
    }
    for p in &scan.payments {
        let data = serde_json::json!({
            "beneficiary": p.beneficiary, "amount_wei": p.amount_wei
        });
        let _ = sqlx::query(
            "INSERT OR IGNORE INTO work_events (work_id, event_type, block_number, tx_hash, data) VALUES (?, 'payment', ?, ?, ?)"
        )
        .bind(&work_id).bind(p.block_number as i64).bind(&p.tx_hash).bind(data.to_string())
        .execute(&state.pool).await;
    }

    // Update cursor
    sqlx::query(
        "INSERT INTO work_events_cursor (work_id, last_scanned_block) VALUES (?, ?)
         ON CONFLICT(work_id) DO UPDATE SET last_scanned_block = excluded.last_scanned_block"
    )
    .bind(&work_id).bind(scan.last_scanned_block as i64)
    .execute(&state.pool).await?;

    // Read full history from cache
    let rows: Vec<(String, i64, String, String)> = sqlx::query_as(
        "SELECT event_type, block_number, tx_hash, data FROM work_events WHERE work_id = ? ORDER BY block_number LIMIT 5000"
    )
    .bind(&work_id)
    .fetch_all(&state.pool)
    .await?;

    let mut transfers = Vec::new();
    let mut purchases = Vec::new();
    let mut payments = Vec::new();
    let mut total_revenue = alloy::primitives::U256::ZERO;

    for (event_type, block_number, tx_hash, data) in rows {
        let obj: serde_json::Value = serde_json::from_str(&data).unwrap_or_default();
        match event_type.as_str() {
            "transfer" => {
                transfers.push(blockchain::TokenTransferEvent {
                    from: obj["from"].as_str().unwrap_or_default().to_string(),
                    to: obj["to"].as_str().unwrap_or_default().to_string(),
                    token_id: obj["token_id"].as_u64().unwrap_or(0),
                    block_number: block_number as u64,
                    tx_hash,
                });
            }
            "purchase" => {
                purchases.push(blockchain::PurchaseEvent {
                    token_id: obj["token_id"].as_u64().unwrap_or(0),
                    buyer: obj["buyer"].as_str().unwrap_or_default().to_string(),
                    price_wei: obj["price_wei"].as_str().unwrap_or("0").to_string(),
                    block_number: block_number as u64,
                    tx_hash,
                });
            }
            "payment" => {
                let amount_str = obj["amount_wei"].as_str().unwrap_or("0");
                if let Ok(amount) = amount_str.parse::<alloy::primitives::U256>() {
                    total_revenue += amount;
                }
                payments.push(blockchain::PaymentEvent {
                    beneficiary: obj["beneficiary"].as_str().unwrap_or_default().to_string(),
                    amount_wei: amount_str.to_string(),
                    block_number: block_number as u64,
                    tx_hash,
                });
            }
            _ => {}
        }
    }

    Ok(Json(blockchain::TokenHistory {
        transfers,
        purchases,
        payments,
        total_revenue_wei: total_revenue.to_string(),
    }))
}

fn parse_opensea_attributes(raw: &str) -> Vec<OpenSeaTrait> {
    if raw.is_empty() || raw == "[]" {
        return vec![];
    }

    let parsed: Result<Vec<serde_json::Value>, _> = serde_json::from_str(raw);
    match parsed {
        Ok(arr) => arr.into_iter().filter_map(|item| {
            let obj = item.as_object()?;
            // Support both "key"/"trait_type" as the trait name
            let trait_type = obj.get("trait_type")
                .or_else(|| obj.get("key"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let value = obj.get("value").cloned().unwrap_or(serde_json::Value::String(String::new()));
            let display_type = obj.get("display_type").and_then(|v| v.as_str()).map(|s| s.to_string());
            Some(OpenSeaTrait { trait_type, value, display_type })
        }).collect(),
        Err(_) => vec![],
    }
}
