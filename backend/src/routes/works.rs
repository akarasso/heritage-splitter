use alloy::primitives::U256;
use axum::{extract::{State, Path}, Extension, Json};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::middleware::Claims;
use crate::models::{Work, CreateWork, UpdateWork, Allocation, CreateAllocation, Participant, Nft, MintNft, DraftNft, CreateDraftNft, UpdateDraftNft, Project, User};
use crate::routes::allocations::AllocationDetail;
use crate::services::blockchain;
use crate::services::notifications::create_notification;
use crate::AppState;

/// Convert AVAX price string (e.g. "1.5") to wei U256 using string-based decimal parsing
fn avax_to_wei(price_str: &str) -> Result<U256, String> {
    let trimmed = price_str.trim();
    if trimmed.is_empty() || trimmed.starts_with('-') {
        return Err("Invalid price".into());
    }
    let parts: Vec<&str> = trimmed.split('.').collect();
    if parts.len() > 2 {
        return Err("Invalid price".into());
    }
    let integer_part: u128 = parts[0].parse().map_err(|_| "Invalid price")?;
    let decimals = if parts.len() == 2 { parts[1] } else { "" };
    if decimals.len() > 18 {
        return Err("Too many decimal places".into());
    }
    // Pad or truncate to 18 decimal places
    let padded = format!("{:0<18}", decimals);
    let frac_part: u128 = padded.parse().map_err(|_| "Invalid price")?;
    let wei = integer_part
        .checked_mul(1_000_000_000_000_000_000u128)
        .and_then(|v| v.checked_add(frac_part))
        .ok_or("Price too large")?;
    Ok(U256::from(wei))
}

#[derive(Serialize)]
pub struct WorkDetail {
    #[serde(flatten)]
    pub work: Work,
    pub allocations: Vec<AllocationDetail>,
    pub nfts: Vec<Nft>,
    pub draft_nfts: Vec<DraftNft>,
    pub creator_shares_bps: i64,
}

/// Helper: load work + verify project creator
async fn load_work_and_check_creator(
    pool: &sqlx::SqlitePool,
    work_id: &str,
    user_id: &str,
) -> AppResult<(Work, Project)> {
    let work: Work = sqlx::query_as("SELECT * FROM works WHERE id = ?")
        .bind(work_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Work not found".into()))?;

    let project: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
        .bind(&work.project_id)
        .fetch_one(pool)
        .await?;

    if project.creator_id != user_id {
        return Err(AppError::Forbidden("Not project creator".into()));
    }

    Ok((work, project))
}

// POST /api/projects/{id}/works
pub async fn create_work(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(body): Json<CreateWork>,
) -> AppResult<Json<Work>> {
    let project: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
        .bind(&project_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".into()))?;

    if project.creator_id != claims.user_id {
        return Err(AppError::Forbidden("Not project creator".into()));
    }

    // Validate work_type
    if body.work_type != "physical_artwork" && body.work_type != "nft_collection" {
        return Err(AppError::BadRequest("work_type must be 'physical_artwork' or 'nft_collection'".into()));
    }

    // Validate royalty_bps
    if body.royalty_bps < 0 || body.royalty_bps > 10000 {
        return Err(AppError::BadRequest("royalty_bps must be between 0 and 10000".into()));
    }

    if body.name.len() > 200 {
        return Err(AppError::BadRequest("Work name too long (max 200 chars)".into()));
    }
    if body.description.len() > 5000 {
        return Err(AppError::BadRequest("Description too long (max 5000 chars)".into()));
    }

    let work = Work::new(project_id, body);

    sqlx::query(
        "INSERT INTO works (id, project_id, name, description, work_type, status, royalty_bps, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&work.id)
    .bind(&work.project_id)
    .bind(&work.name)
    .bind(&work.description)
    .bind(&work.work_type)
    .bind(&work.status)
    .bind(work.royalty_bps)
    .bind(work.created_at)
    .execute(&state.pool)
    .await?;

    Ok(Json(work))
}

// GET /api/projects/{id}/works
pub async fn list_works(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> AppResult<Json<Vec<Work>>> {
    let works: Vec<Work> = sqlx::query_as(
        "SELECT * FROM works WHERE project_id = ? ORDER BY created_at LIMIT 200"
    )
    .bind(&project_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(works))
}

// GET /api/works/{id}
pub async fn get_work(
    State(state): State<AppState>,
    Path(work_id): Path<String>,
) -> AppResult<Json<WorkDetail>> {
    let work: Work = sqlx::query_as("SELECT * FROM works WHERE id = ?")
        .bind(&work_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Work not found".into()))?;

    let allocations: Vec<Allocation> = sqlx::query_as(
        "SELECT * FROM allocations WHERE work_id = ? ORDER BY sort_order, created_at LIMIT 200"
    )
    .bind(&work_id)
    .fetch_all(&state.pool)
    .await?;

    // Fetch all participants for all allocations in one query
    let all_alloc_participants: Vec<Participant> = sqlx::query_as(
        "SELECT p.* FROM participants p
         INNER JOIN allocations a ON p.allocation_id = a.id
         WHERE a.work_id = ? LIMIT 500"
    )
    .bind(&work_id)
    .fetch_all(&state.pool)
    .await?;

    let mut alloc_details = Vec::new();
    let mut total_alloc_bps: i64 = 0;
    for alloc in allocations {
        let participants: Vec<Participant> = all_alloc_participants
            .iter()
            .filter(|p| p.allocation_id.as_deref() == Some(&alloc.id))
            .cloned()
            .collect();

        let filled = participants.len() as i64;
        let open = alloc.max_slots.map(|max| (max - filled).max(0));
        total_alloc_bps += alloc.total_bps;

        alloc_details.push(AllocationDetail {
            allocation: alloc,
            participants,
            filled_slots: filled,
            open_slots: open,
        });
    }

    let nfts: Vec<Nft> = sqlx::query_as(
        "SELECT * FROM nfts WHERE work_id = ? ORDER BY token_id LIMIT 500"
    )
    .bind(&work_id)
    .fetch_all(&state.pool)
    .await?;

    let draft_nfts: Vec<DraftNft> = sqlx::query_as(
        "SELECT * FROM draft_nfts WHERE work_id = ? ORDER BY created_at LIMIT 500"
    )
    .bind(&work_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(WorkDetail {
        work,
        allocations: alloc_details,
        nfts,
        draft_nfts,
        creator_shares_bps: (10000 - total_alloc_bps).max(0),
    }))
}

// PUT /api/works/{id}
pub async fn update_work(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(work_id): Path<String>,
    Json(body): Json<UpdateWork>,
) -> AppResult<Json<Work>> {
    let (work, _project) = load_work_and_check_creator(&state.pool, &work_id, &claims.user_id).await?;

    if work.status != "draft" {
        return Err(AppError::BadRequest("Can only edit draft works".into()));
    }

    if let Some(ref name) = body.name {
        if name.len() > 200 {
            return Err(AppError::BadRequest("Work name too long (max 200 chars)".into()));
        }
        sqlx::query("UPDATE works SET name = ? WHERE id = ?")
            .bind(name).bind(&work_id).execute(&state.pool).await?;
    }
    if let Some(ref description) = body.description {
        if description.len() > 5000 {
            return Err(AppError::BadRequest("Description too long (max 5000 chars)".into()));
        }
        sqlx::query("UPDATE works SET description = ? WHERE id = ?")
            .bind(description).bind(&work_id).execute(&state.pool).await?;
    }
    if let Some(royalty_bps) = body.royalty_bps {
        if royalty_bps < 0 || royalty_bps > 10000 {
            return Err(AppError::BadRequest("royalty_bps must be between 0 and 10000".into()));
        }
        sqlx::query("UPDATE works SET royalty_bps = ? WHERE id = ?")
            .bind(royalty_bps).bind(&work_id).execute(&state.pool).await?;
    }

    let updated: Work = sqlx::query_as("SELECT * FROM works WHERE id = ?")
        .bind(&work_id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(updated))
}

// DELETE /api/works/{id}
pub async fn delete_work(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(work_id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    let (work, project) = load_work_and_check_creator(&state.pool, &work_id, &claims.user_id).await?;

    if work.status != "draft" {
        return Err(AppError::BadRequest("Can only delete draft works".into()));
    }

    // Prevent deletion if project is in a locked state
    if !["draft", "active"].contains(&project.status.as_str()) {
        return Err(AppError::BadRequest("Cannot delete works when project is in a locked state".into()));
    }

    let alloc_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM allocations WHERE work_id = ?"
    )
    .bind(&work_id)
    .fetch_one(&state.pool)
    .await?;

    if alloc_count > 0 {
        return Err(AppError::BadRequest("Cannot delete work with allocations. Delete allocations first.".into()));
    }

    sqlx::query("DELETE FROM works WHERE id = ?")
        .bind(&work_id)
        .execute(&state.pool)
        .await?;

    Ok(Json(serde_json::json!({ "deleted": true })))
}

// POST /api/works/{id}/submit-for-approval
pub async fn submit_work_for_approval(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(work_id): Path<String>,
) -> AppResult<Json<Work>> {
    let (work, project) = load_work_and_check_creator(&state.pool, &work_id, &claims.user_id).await?;

    if work.status != "draft" {
        return Err(AppError::BadRequest("Work must be in draft status".into()));
    }

    // Validate allocations exist and have participants
    let allocations: Vec<Allocation> = sqlx::query_as(
        "SELECT * FROM allocations WHERE work_id = ?"
    )
    .bind(&work_id)
    .fetch_all(&state.pool)
    .await?;

    // Get all active participants in this work's allocations
    let work_participants: Vec<Participant> = sqlx::query_as(
        "SELECT p.* FROM participants p
         INNER JOIN allocations a ON p.allocation_id = a.id
         WHERE a.work_id = ? AND p.status NOT IN ('rejected', 'kicked')"
    )
    .bind(&work_id)
    .fetch_all(&state.pool)
    .await?;

    for alloc in &allocations {
        let count = work_participants.iter().filter(|p| p.allocation_id.as_deref() == Some(&alloc.id)).count();
        if count == 0 {
            return Err(AppError::BadRequest(
                format!("Allocation '{}': needs at least one participant", alloc.label)
            ));
        }
    }

    if work_participants.is_empty() {
        // Solo mode: no participants → skip straight to ready_to_deploy
        sqlx::query("UPDATE works SET status = 'ready_to_deploy' WHERE id = ?")
            .bind(&work_id)
            .execute(&state.pool)
            .await?;
    } else {
        // B5-5: Wrap approved_at reset + status change in a single transaction
        {
            let mut tx = state.pool.begin().await?;
            for pt in &work_participants {
                sqlx::query("UPDATE participants SET approved_at = NULL WHERE id = ?")
                    .bind(&pt.id)
                    .execute(&mut *tx)
                    .await?;
            }
            sqlx::query("UPDATE works SET status = 'pending_approval' WHERE id = ?")
                .bind(&work_id)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
        }

        // Notify each participant
        for pt in &work_participants {
            if let Some(ref uid) = pt.user_id {
                let _ = create_notification(
                    &state.pool,
                    &state.notifier,
                    uid,
                    "work_approval_requested",
                    &format!("Approval required for \"{}\"", work.name),
                    &format!("The creator of \"{}\" is asking you to approve the terms.", project.name),
                    Some(&work.project_id),
                    Some(&work_id),
                ).await;
            }
        }

        // Auto-approve bot participants (with delay for realism)
        let bot_participants: Vec<(String, String)> = {
            let mut bots = Vec::new();
            for pt in &work_participants {
                if let Some(ref uid) = pt.user_id {
                    let is_bot: bool = sqlx::query_scalar::<_, bool>("SELECT is_bot FROM users WHERE id = ?")
                        .bind(uid)
                        .fetch_optional(&state.pool)
                        .await?
                        .unwrap_or(false);
                    if is_bot {
                        bots.push((pt.id.clone(), uid.clone()));
                    }
                }
            }
            bots
        };

        if !bot_participants.is_empty() {
            let pool = state.pool.clone();
            let notifier = state.notifier.clone();
            let work_id_clone = work_id.clone();
            let work_name = work.name.clone();
            let project_id = work.project_id.clone();
            let creator_id = project.creator_id.clone();
            let bot_delay = state.config.bot_delay_secs;

            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(bot_delay)).await;

                for (participant_id, bot_user_id) in &bot_participants {
                    let _ = sqlx::query("UPDATE participants SET approved_at = CURRENT_TIMESTAMP WHERE id = ?")
                        .bind(participant_id)
                        .execute(&pool)
                        .await;

                    let bot_name: String = sqlx::query_scalar("SELECT display_name FROM users WHERE id = ?")
                        .bind(bot_user_id)
                        .fetch_optional(&pool)
                        .await
                        .ok()
                        .flatten()
                        .unwrap_or_else(|| "Bot".to_string());

                    let _ = create_notification(
                        &pool,
                        &notifier,
                        &creator_id,
                        "work_participant_approved",
                        &format!("{} approved the terms for \"{}\"", bot_name, work_name),
                        "",
                        Some(&project_id),
                        Some(&work_id_clone),
                    ).await;

                    tracing::info!("Bot {} auto-approved work terms for {}", bot_user_id, work_id_clone);
                }

                // Check if all participants have now approved
                let not_approved: i64 = sqlx::query_scalar(
                    "SELECT COUNT(*) FROM participants p
                     INNER JOIN allocations a ON p.allocation_id = a.id
                     WHERE a.work_id = ? AND p.status NOT IN ('rejected', 'kicked') AND p.approved_at IS NULL"
                )
                .bind(&work_id_clone)
                .fetch_one(&pool)
                .await
                .unwrap_or(1);

                if not_approved == 0 {
                    let _ = sqlx::query("UPDATE works SET status = 'approved' WHERE id = ?")
                        .bind(&work_id_clone)
                        .execute(&pool)
                        .await;

                    let _ = create_notification(
                        &pool,
                        &notifier,
                        &creator_id,
                        "work_all_approved",
                        &format!("All collaborators approved \"{}\"", work_name),
                        &format!("Validate final approval to prepare deployment of \"{}\".", work_name),
                        Some(&project_id),
                        Some(&work_id_clone),
                    ).await;
                }
            });
        }
    }

    let updated: Work = sqlx::query_as("SELECT * FROM works WHERE id = ?")
        .bind(&work_id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(updated))
}

/// Compute SHA256 of the image data and inject `content_hash` into the attributes JSON.
/// If image_url is a data URI, hash the decoded bytes. Otherwise hash the raw URL string.
fn inject_content_hash(image_url: &str, attributes_json: &str) -> String {
    let hash_hex = if let Some(data_part) = image_url.strip_prefix("data:") {
        // data:image/png;base64,AAAA...
        if let Some((_, b64)) = data_part.split_once(',') {
            use base64::Engine;
            match base64::engine::general_purpose::STANDARD.decode(b64) {
                Ok(bytes) => {
                    let digest = Sha256::digest(&bytes);
                    format!("sha256:{:x}", digest)
                }
                Err(_) => return attributes_json.to_string(),
            }
        } else {
            return attributes_json.to_string();
        }
    } else if !image_url.is_empty() {
        // For external URLs, hash the URL itself (the image isn't available locally)
        let digest = Sha256::digest(image_url.as_bytes());
        format!("sha256:{:x}", digest)
    } else {
        return attributes_json.to_string();
    };

    // Parse existing attributes, append content_hash
    let mut attrs: Vec<serde_json::Value> = serde_json::from_str(attributes_json).unwrap_or_default();

    // Remove any existing content_hash
    attrs.retain(|a| {
        let key = a.get("trait_type").or_else(|| a.get("key")).and_then(|v| v.as_str());
        key != Some("content_hash")
    });

    attrs.push(serde_json::json!({
        "trait_type": "content_hash",
        "value": hash_hex
    }));

    serde_json::to_string(&attrs).unwrap_or_else(|_| attributes_json.to_string())
}

// POST /api/works/{id}/deploy
pub async fn deploy_work(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(work_id): Path<String>,
) -> AppResult<Json<Work>> {
    let (work, _project) = load_work_and_check_creator(&state.pool, &work_id, &claims.user_id).await?;

    if work.status != "ready_to_deploy" {
        return Err(AppError::BadRequest("Work must be validated before deployment".into()));
    }

    // B5-4: Validate config addresses before attempting deploy
    if state.config.factory_address.is_empty() {
        return Err(AppError::Internal("factory_address is not configured — cannot deploy".into()));
    }
    if state.config.registry_address.is_empty() {
        return Err(AppError::Internal("registry_address is not configured — cannot deploy".into()));
    }

    // Atomically claim the deploy slot to prevent concurrent deployments
    let claim = sqlx::query(
        "UPDATE works SET status = 'deploying' WHERE id = ? AND status = 'ready_to_deploy'"
    )
    .bind(&work_id)
    .execute(&state.pool)
    .await?;
    if claim.rows_affected() == 0 {
        return Err(AppError::BadRequest("Deployment already in progress".into()));
    }

    // Get creator's wallet address (producer on-chain)
    let creator: User = sqlx::query_as("SELECT * FROM users WHERE id = ?")
        .bind(&claims.user_id)
        .fetch_one(&state.pool)
        .await?;

    // Validate allocations and build beneficiary arrays
    let allocations: Vec<Allocation> = sqlx::query_as(
        "SELECT * FROM allocations WHERE work_id = ?"
    )
    .bind(&work_id)
    .fetch_all(&state.pool)
    .await?;

    let mut wallets: Vec<String> = Vec::new();
    let mut shares: Vec<u64> = Vec::new();

    // Creator's share
    let total_alloc_bps: i64 = allocations.iter().map(|a| a.total_bps).sum();
    let creator_shares_bps = (10000 - total_alloc_bps).max(0);
    if creator_shares_bps > 0 {
        wallets.push(creator.wallet_address.clone());
        shares.push(creator_shares_bps as u64);
    }

    for alloc in &allocations {
        let participants: Vec<Participant> = sqlx::query_as(
            "SELECT * FROM participants WHERE allocation_id = ? AND status NOT IN ('rejected', 'kicked')"
        )
        .bind(&alloc.id)
        .fetch_all(&state.pool)
        .await?;

        if participants.is_empty() {
            return Err(AppError::BadRequest(
                format!("Allocation '{}': needs at least one participant", alloc.label)
            ));
        }

        // B4-1: Check approved_at instead of status — approve_work_terms sets approved_at without changing status from "invited"
        let all_approved = participants.iter().all(|p| p.approved_at.is_some());
        if !all_approved {
            return Err(AppError::BadRequest(
                format!("Allocation '{}': not all participants have approved", alloc.label)
            ));
        }

        if alloc.distribution_mode == "equal" {
            let n = participants.len() as i64;
            let per_participant = alloc.total_bps / n;
            let mut remainder = alloc.total_bps - per_participant * n;
            let mut distributed: i64 = 0;
            for p in &participants {
                let extra = if remainder > 0 { remainder -= 1; 1i64 } else { 0 };
                let share = per_participant + extra;
                distributed += share;
                wallets.push(p.wallet_address.clone());
                shares.push(share as u64);
            }
            // B2-3: Verify no bps lost due to integer truncation
            if distributed != alloc.total_bps {
                return Err(AppError::Internal(
                    format!("Allocation '{}': equal split distributed {} bps instead of {}", alloc.label, distributed, alloc.total_bps)
                ));
            }
        } else {
            // custom mode
            let sum: i64 = participants.iter().map(|p| p.shares_bps).sum();
            if sum != alloc.total_bps {
                return Err(AppError::BadRequest(
                    format!("Allocation '{}': shares sum {} != {}", alloc.label, sum, alloc.total_bps)
                ));
            }
            for p in &participants {
                wallets.push(p.wallet_address.clone());
                shares.push(p.shares_bps as u64);
            }
        }
    }

    // Solo creator with no allocations
    if wallets.is_empty() {
        wallets.push(creator.wallet_address.clone());
        shares.push(10000);
    }

    // Load draft NFTs
    let drafts: Vec<DraftNft> = sqlx::query_as(
        "SELECT * FROM draft_nfts WHERE work_id = ?"
    )
    .bind(&work_id)
    .fetch_all(&state.pool)
    .await?;

    // URIs are placeholders — deploy_collection rewrites them with proper metadata URLs
    let nft_uris: Vec<String> = drafts.iter().map(|_| String::new()).collect();

    let nft_prices: Vec<U256> = drafts.iter().map(|d| {
        if d.price.is_empty() {
            Ok(U256::ZERO)
        } else {
            avax_to_wei(&d.price)
        }
    }).collect::<Result<Vec<_>, _>>().map_err(|e| AppError::BadRequest(format!("Invalid price: {}", e)))?;

    let symbol = work.name.chars().filter(|c| c.is_ascii_alphabetic()).take(5)
        .collect::<String>().to_uppercase();
    let symbol = if symbol.is_empty() { "HRTG".to_string() } else { symbol };

    // Deploy on-chain via backend wallet
    let metadata_base = format!("{}/api/metadata", state.config.base_url.trim_end_matches('/'));
    let deploy_result = blockchain::deploy_collection(
        &state.config.avalanche_rpc_url,
        &state.config.certifier_private_key,
        &state.config.factory_address,
        &creator.wallet_address,
        &work.name,
        &symbol,
        wallets,
        shares,
        work.royalty_bps as u64,
        nft_uris,
        nft_prices,
        &state.config.registry_address,
        Some(&metadata_base),
    ).await.map_err(|e| {
        // Revert status on failure so user can retry
        let pool = state.pool.clone();
        let wid = work_id.clone();
        tokio::spawn(async move {
            let _ = sqlx::query("UPDATE works SET status = 'ready_to_deploy' WHERE id = ? AND status = 'deploying'")
                .bind(&wid).execute(&pool).await;
        });
        AppError::Internal(format!("Blockchain deploy failed: {}", e))
    })?;

    // Save contract addresses and deploy block number
    sqlx::query(
        "UPDATE works SET status = 'deployed', completed_at = CURRENT_TIMESTAMP,
         contract_nft_address = ?, contract_splitter_address = ?, contract_vault_address = ?,
         deploy_block_number = ?
         WHERE id = ?"
    )
        .bind(&deploy_result.nft_address)
        .bind(&deploy_result.splitter_address)
        .bind(&deploy_result.vault_address)
        .bind(deploy_result.block_number as i64)
        .bind(&work_id)
        .execute(&state.pool)
        .await?;

    // Move draft NFTs to minted nfts table
    let existing_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM nfts WHERE work_id = ?"
    )
    .bind(&work_id)
    .fetch_one(&state.pool)
    .await?;

    let metadata_base_ref = &metadata_base;
    for (i, draft) in drafts.iter().enumerate() {
        let nft_id = Uuid::new_v4().to_string();
        let token_id = existing_count + i as i64;
        let metadata_uri = format!("{}/{}/{}", metadata_base_ref, deploy_result.nft_address, token_id);
        let attributes_with_hash = inject_content_hash(&draft.image_url, &draft.attributes);
        sqlx::query(
            "INSERT INTO nfts (id, project_id, token_id, metadata_uri, title, artist_name, description, image_url, price, attributes, phase, work_id, minted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'primary', ?, CURRENT_TIMESTAMP)"
        )
        .bind(&nft_id)
        .bind(&work.project_id)
        .bind(token_id)
        .bind(&metadata_uri)
        .bind(&draft.title)
        .bind(&draft.artist_name)
        .bind(&draft.description)
        .bind(&draft.image_url)
        .bind(&draft.price)
        .bind(&attributes_with_hash)
        .bind(&work_id)
        .execute(&state.pool)
        .await?;
    }

    // Remove all draft NFTs now that they're minted
    sqlx::query("DELETE FROM draft_nfts WHERE work_id = ?")
        .bind(&work_id)
        .execute(&state.pool)
        .await?;

    let updated: Work = sqlx::query_as("SELECT * FROM works WHERE id = ?")
        .bind(&work_id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(updated))
}

// POST /api/works/{id}/approve — participant approves work terms (or mint approval)
pub async fn approve_work_terms(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(work_id): Path<String>,
) -> AppResult<Json<Work>> {
    let work: Work = sqlx::query_as("SELECT * FROM works WHERE id = ?")
        .bind(&work_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Work not found".into()))?;

    let is_mint_approval = work.status == "pending_mint_approval";
    if work.status != "pending_approval" && !is_mint_approval {
        return Err(AppError::BadRequest("Work is not pending approval".into()));
    }

    // Find participant for current user in this work's allocations
    let participant: Participant = sqlx::query_as(
        "SELECT p.* FROM participants p
         INNER JOIN allocations a ON p.allocation_id = a.id
         WHERE a.work_id = ? AND p.user_id = ? AND p.status NOT IN ('rejected', 'kicked')
         LIMIT 1"
    )
    .bind(&work_id)
    .bind(&claims.user_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::Forbidden("You are not a participant in this work".into()))?;

    if participant.approved_at.is_some() {
        return Err(AppError::BadRequest("You have already approved".into()));
    }

    // Set approved_at for all participant entries of this user in this work
    sqlx::query(
        "UPDATE participants SET approved_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND allocation_id IN (SELECT id FROM allocations WHERE work_id = ?) AND status NOT IN ('rejected', 'kicked')"
    )
    .bind(&claims.user_id)
    .bind(&work_id)
    .execute(&state.pool)
    .await?;

    let project: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
        .bind(&work.project_id)
        .fetch_one(&state.pool)
        .await?;

    // Notify creator
    let approver_name: String = sqlx::query_scalar("SELECT display_name FROM users WHERE id = ?")
        .bind(&claims.user_id)
        .fetch_optional(&state.pool)
        .await?
        .unwrap_or_default();

    let _ = create_notification(
        &state.pool,
        &state.notifier,
        &project.creator_id,
        "work_participant_approved",
        &format!("{} approved the terms for \"{}\"", if approver_name.is_empty() { "A collaborator" } else { &approver_name }, work.name),
        "",
        Some(&work.project_id),
        Some(&work_id),
    ).await;

    // Atomically transition if all participants have approved
    let new_status = if is_mint_approval { "mint_ready" } else { "approved" };
    let expected_status = if is_mint_approval { "pending_mint_approval" } else { "pending_approval" };
    let result = sqlx::query(
        "UPDATE works SET status = ? WHERE id = ? AND status = ?
         AND NOT EXISTS (
             SELECT 1 FROM participants p
             INNER JOIN allocations a ON p.allocation_id = a.id
             WHERE a.work_id = ? AND p.status NOT IN ('rejected', 'kicked') AND p.approved_at IS NULL
         )"
    )
    .bind(new_status)
    .bind(&work_id)
    .bind(expected_status)
    .bind(&work_id)
    .execute(&state.pool)
    .await?;

    if result.rows_affected() > 0 {
        let msg = if is_mint_approval {
            "The NFTs are ready to be minted."
        } else {
            "Validate final approval to prepare deployment."
        };

        let _ = create_notification(
            &state.pool,
            &state.notifier,
            &project.creator_id,
            "work_all_approved",
            &format!("All collaborators approved \"{}\"", work.name),
            msg,
            Some(&work.project_id),
            Some(&work_id),
        ).await;
    }

    let updated: Work = sqlx::query_as("SELECT * FROM works WHERE id = ?")
        .bind(&work_id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(updated))
}

// POST /api/works/{id}/validate-approval — creator final validation after all participants approved
pub async fn validate_approval(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(work_id): Path<String>,
) -> AppResult<Json<Work>> {
    let (work, _project) = load_work_and_check_creator(&state.pool, &work_id, &claims.user_id).await?;

    if work.status != "approved" {
        return Err(AppError::BadRequest("Work must be in approved status".into()));
    }

    sqlx::query("UPDATE works SET status = 'ready_to_deploy' WHERE id = ?")
        .bind(&work_id)
        .execute(&state.pool)
        .await?;

    let updated: Work = sqlx::query_as("SELECT * FROM works WHERE id = ?")
        .bind(&work_id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(updated))
}

// POST /api/works/{id}/allocations
pub async fn create_work_allocation(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(work_id): Path<String>,
    Json(mut body): Json<CreateAllocation>,
) -> AppResult<Json<Allocation>> {
    let (work, _project) = load_work_and_check_creator(&state.pool, &work_id, &claims.user_id).await?;

    if ["pending_approval", "approved"].contains(&work.status.as_str()) {
        // Auto-reset to draft
        sqlx::query("UPDATE works SET status = 'draft' WHERE id = ?")
            .bind(&work_id).execute(&state.pool).await?;
        sqlx::query(
            "UPDATE participants SET approved_at = NULL
             WHERE allocation_id IN (SELECT id FROM allocations WHERE work_id = ?) AND status NOT IN ('rejected', 'kicked')"
        ).bind(&work_id).execute(&state.pool).await?;
    } else if work.status != "draft" {
        return Err(AppError::BadRequest("Can only edit draft works".into()));
    }

    if body.role.len() > 100 {
        return Err(AppError::BadRequest("Role too long (max 100 chars)".into()));
    }
    if body.label.len() > 200 {
        return Err(AppError::BadRequest("Label too long (max 200 chars)".into()));
    }
    // B5-1: Validate distribution_mode (same as allocations.rs)
    if body.distribution_mode != "equal" && body.distribution_mode != "custom" {
        return Err(AppError::BadRequest("distribution_mode must be 'equal' or 'custom'".into()));
    }

    if let Some(max) = body.max_slots {
        if max <= 0 {
            return Err(AppError::BadRequest("max_slots must be greater than 0".into()));
        }
        // B5-3: Upper bound on max_slots (same as allocations.rs)
        if max > 1000 {
            return Err(AppError::BadRequest("max_slots cannot exceed 1000".into()));
        }
    }
    if body.total_bps <= 0 || body.total_bps > 10000 {
        return Err(AppError::BadRequest("total_bps must be between 1 and 10000".into()));
    }

    let existing_sum: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_bps), 0) FROM allocations WHERE work_id = ?"
    )
    .bind(&work_id)
    .fetch_one(&state.pool)
    .await?;

    if existing_sum + body.total_bps > 10000 {
        return Err(AppError::BadRequest(
            format!("Total allocations would be {} bps (max 10000)", existing_sum + body.total_bps)
        ));
    }

    // Force work_id on the allocation
    body.work_id = Some(work_id.clone());
    let allocation = Allocation::new(work.project_id, body);

    sqlx::query(
        "INSERT INTO allocations (id, project_id, role, label, total_bps, max_slots, distribution_mode, sort_order, receives_primary, work_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&allocation.id)
    .bind(&allocation.project_id)
    .bind(&allocation.role)
    .bind(&allocation.label)
    .bind(allocation.total_bps)
    .bind(allocation.max_slots)
    .bind(&allocation.distribution_mode)
    .bind(allocation.sort_order)
    .bind(allocation.receives_primary)
    .bind(&allocation.work_id)
    .bind(allocation.created_at)
    .execute(&state.pool)
    .await?;

    Ok(Json(allocation))
}

// POST /api/works/{id}/mint — mint a specific draft NFT by draft_nft_id
pub async fn mint_work_nft(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(work_id): Path<String>,
    Json(body): Json<MintNft>,
) -> AppResult<Json<Nft>> {
    let (work, _project) = load_work_and_check_creator(&state.pool, &work_id, &claims.user_id).await?;

    if work.work_type != "nft_collection" {
        return Err(AppError::BadRequest("Can only mint NFTs for nft_collection works".into()));
    }

    if work.status != "mint_ready" {
        return Err(AppError::BadRequest("Work must be in mint_ready status to mint NFTs".into()));
    }

    // Find the draft NFT by ID first, fall back to title match
    let draft: Option<DraftNft> = if let Some(ref draft_id) = body.draft_nft_id {
        sqlx::query_as("SELECT * FROM draft_nfts WHERE id = ? AND work_id = ?")
            .bind(draft_id)
            .bind(&work_id)
            .fetch_optional(&state.pool)
            .await?
    } else {
        sqlx::query_as("SELECT * FROM draft_nfts WHERE work_id = ? AND title = ? LIMIT 1")
            .bind(&work_id)
            .bind(&body.title)
            .fetch_optional(&state.pool)
            .await?
    };

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM nfts WHERE work_id = ?"
    )
    .bind(&work_id)
    .fetch_one(&state.pool)
    .await?;

    let (description, image_url, price, attributes) = if let Some(ref d) = draft {
        (d.description.clone(), d.image_url.clone(), d.price.clone(), d.attributes.clone())
    } else {
        (String::new(), String::new(), String::new(), "[]".into())
    };

    let attributes_with_hash = inject_content_hash(&image_url, &attributes);

    let nft_contract = work.contract_nft_address.as_deref()
        .ok_or_else(|| AppError::BadRequest("No NFT contract address on this work".into()))?;
    let metadata_base = format!("{}/api/metadata", state.config.base_url.trim_end_matches('/'));
    let metadata_uri = format!("{}/{}/{}", metadata_base, nft_contract, count);

    let nft = Nft {
        id: Uuid::new_v4().to_string(),
        project_id: work.project_id,
        token_id: count,
        metadata_uri,
        title: body.title,
        artist_name: body.artist_name,
        description: description.clone(),
        image_url: image_url.clone(),
        price: price.clone(),
        attributes: attributes_with_hash.clone(),
        phase: "primary".into(),
        work_id: Some(work_id.clone()),
        minted_at: chrono::Utc::now().naive_utc(),
    };

    // Mint on-chain FIRST, then persist to DB (avoid orphan records if chain call fails)
    let vault_address = work.contract_vault_address.as_deref()
        .ok_or_else(|| AppError::BadRequest("No vault address on this work".into()))?;

    let uri = nft.metadata_uri.clone();

    let price_wei = if price.is_empty() {
        U256::ZERO
    } else {
        avax_to_wei(&price).map_err(|e| AppError::BadRequest(format!("Invalid price: {}", e)))?
    };

    blockchain::mint_additional_nfts(
        &state.config.avalanche_rpc_url,
        &state.config.certifier_private_key,
        nft_contract,
        vault_address,
        vec![uri],
        vec![nft.token_id as u64],
        vec![price_wei],
    ).await.map_err(|e| AppError::Internal(format!("On-chain mint failed: {}", e)))?;

    // On-chain mint succeeded — now persist to DB
    sqlx::query(
        "INSERT INTO nfts (id, project_id, token_id, metadata_uri, title, artist_name, description, image_url, price, attributes, phase, work_id, minted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&nft.id)
    .bind(&nft.project_id)
    .bind(nft.token_id)
    .bind(&nft.metadata_uri)
    .bind(&nft.title)
    .bind(&nft.artist_name)
    .bind(&description)
    .bind(&image_url)
    .bind(&price)
    .bind(&attributes_with_hash)
    .bind(&nft.phase)
    .bind(&nft.work_id)
    .bind(nft.minted_at)
    .execute(&state.pool)
    .await?;

    // Remove the corresponding draft NFT
    if let Some(d) = draft {
        sqlx::query("DELETE FROM draft_nfts WHERE id = ?")
            .bind(&d.id)
            .execute(&state.pool)
            .await?;
    }

    // Check if all drafts have been minted → auto-transition back to deployed
    let remaining: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM draft_nfts WHERE work_id = ?"
    )
    .bind(&work_id)
    .fetch_one(&state.pool)
    .await?;

    if remaining == 0 {
        sqlx::query("UPDATE works SET status = 'deployed' WHERE id = ?")
            .bind(&work_id)
            .execute(&state.pool)
            .await?;
    }

    Ok(Json(nft))
}

// GET /api/works/{id}/nfts
pub async fn list_work_nfts(
    State(state): State<AppState>,
    Path(work_id): Path<String>,
) -> AppResult<Json<Vec<Nft>>> {
    let nfts: Vec<Nft> = sqlx::query_as(
        "SELECT * FROM nfts WHERE work_id = ? ORDER BY token_id LIMIT 500"
    )
    .bind(&work_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(nfts))
}

/// Helper: auto-reset approval status when NFTs are modified.
/// - pending_approval → draft (pre-deploy: NFT change cancels approval)
/// - pending_mint_approval → deployed (post-deploy: NFT change cancels mint approval)
async fn auto_reset_on_nft_change(pool: &sqlx::SqlitePool, work_id: &str) -> AppResult<()> {
    // Atomic: reset status in a single UPDATE to prevent TOCTOU races
    let result = sqlx::query(
        "UPDATE works SET status = CASE status
            WHEN 'pending_approval' THEN 'draft'
            WHEN 'approved' THEN 'draft'
            WHEN 'pending_mint_approval' THEN 'deployed'
         END
         WHERE id = ? AND status IN ('pending_approval', 'approved', 'pending_mint_approval')"
    )
    .bind(work_id)
    .execute(pool)
    .await?;

    if result.rows_affected() > 0 {
        // Reset approved_at for all participants
        sqlx::query(
            "UPDATE participants SET approved_at = NULL
             WHERE allocation_id IN (SELECT id FROM allocations WHERE work_id = ?) AND status NOT IN ('rejected', 'kicked')"
        )
        .bind(work_id)
        .execute(pool)
        .await?;
    }
    Ok(())
}

// GET /api/works/{id}/draft-nfts
pub async fn list_draft_nfts(
    State(state): State<AppState>,
    Path(work_id): Path<String>,
) -> AppResult<Json<Vec<DraftNft>>> {
    let drafts: Vec<DraftNft> = sqlx::query_as(
        "SELECT * FROM draft_nfts WHERE work_id = ? ORDER BY created_at LIMIT 500"
    )
    .bind(&work_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(drafts))
}

// POST /api/works/{id}/draft-nfts
pub async fn create_draft_nft(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(work_id): Path<String>,
    Json(body): Json<CreateDraftNft>,
) -> AppResult<Json<DraftNft>> {
    let (work, _project) = load_work_and_check_creator(&state.pool, &work_id, &claims.user_id).await?;

    if !["draft", "pending_approval", "approved", "deployed", "pending_mint_approval"].contains(&work.status.as_str()) {
        return Err(AppError::BadRequest("Cannot add draft NFTs in this status".into()));
    }

    // Auto-reset if pending_mint_approval
    auto_reset_on_nft_change(&state.pool, &work_id).await?;

    // Validate draft NFT fields
    if body.title.len() > 200 {
        return Err(AppError::BadRequest("NFT title too long (max 200 chars)".into()));
    }
    if body.description.as_ref().map_or(false, |d| d.len() > 5000) {
        return Err(AppError::BadRequest("NFT description too long (max 5000 chars)".into()));
    }
    if body.image_url.as_ref().map_or(false, |u| u.len() > 500_000) {
        return Err(AppError::BadRequest("Image URL too long".into()));
    }
    if body.artist_name.as_ref().map_or(false, |a| a.len() > 200) {
        return Err(AppError::BadRequest("Artist name too long (max 200 chars)".into()));
    }
    if body.price.as_ref().map_or(false, |p| p.len() > 100) {
        return Err(AppError::BadRequest("Price too long (max 100 chars)".into()));
    }
    if body.metadata_uri.as_ref().map_or(false, |u| u.len() > 2000) {
        return Err(AppError::BadRequest("Metadata URI too long (max 2000 chars)".into()));
    }
    if body.attributes.as_ref().map_or(false, |a| a.len() > 10_000) {
        return Err(AppError::BadRequest("Attributes too long (max 10000 chars)".into()));
    }

    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().naive_utc();

    sqlx::query(
        "INSERT INTO draft_nfts (id, work_id, title, description, artist_name, price, image_url, metadata_uri, attributes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(&work_id)
    .bind(&body.title)
    .bind(body.description.as_deref().unwrap_or(""))
    .bind(body.artist_name.as_deref().unwrap_or(""))
    .bind(body.price.as_deref().unwrap_or(""))
    .bind(body.image_url.as_deref().unwrap_or(""))
    .bind(body.metadata_uri.as_deref().unwrap_or(""))
    .bind(body.attributes.as_deref().unwrap_or("[]"))
    .bind(now)
    .execute(&state.pool)
    .await?;

    let draft: DraftNft = sqlx::query_as("SELECT * FROM draft_nfts WHERE id = ?")
        .bind(&id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(draft))
}

// PUT /api/draft-nfts/{id}
pub async fn update_draft_nft(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(draft_id): Path<String>,
    Json(body): Json<UpdateDraftNft>,
) -> AppResult<Json<DraftNft>> {
    let draft: DraftNft = sqlx::query_as("SELECT * FROM draft_nfts WHERE id = ?")
        .bind(&draft_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Draft NFT not found".into()))?;

    // Verify creator
    let (work, _project) = load_work_and_check_creator(&state.pool, &draft.work_id, &claims.user_id).await?;

    // Block modification in locked states
    if ["ready_to_deploy", "deploying", "mint_ready"].contains(&work.status.as_str()) {
        return Err(AppError::BadRequest("Cannot modify draft NFTs in this status".into()));
    }

    // Auto-reset if pending_mint_approval
    auto_reset_on_nft_change(&state.pool, &draft.work_id).await?;

    if let Some(ref title) = body.title {
        if title.len() > 200 {
            return Err(AppError::BadRequest("NFT title too long (max 200 chars)".into()));
        }
        sqlx::query("UPDATE draft_nfts SET title = ? WHERE id = ?")
            .bind(title).bind(&draft_id).execute(&state.pool).await?;
    }
    if let Some(ref description) = body.description {
        if description.len() > 5000 {
            return Err(AppError::BadRequest("NFT description too long (max 5000 chars)".into()));
        }
        sqlx::query("UPDATE draft_nfts SET description = ? WHERE id = ?")
            .bind(description).bind(&draft_id).execute(&state.pool).await?;
    }
    if let Some(ref artist_name) = body.artist_name {
        if artist_name.len() > 200 {
            return Err(AppError::BadRequest("Artist name too long (max 200 chars)".into()));
        }
        sqlx::query("UPDATE draft_nfts SET artist_name = ? WHERE id = ?")
            .bind(artist_name).bind(&draft_id).execute(&state.pool).await?;
    }
    if let Some(ref price) = body.price {
        if price.len() > 100 {
            return Err(AppError::BadRequest("Price too long (max 100 chars)".into()));
        }
        sqlx::query("UPDATE draft_nfts SET price = ? WHERE id = ?")
            .bind(price).bind(&draft_id).execute(&state.pool).await?;
    }
    if let Some(ref image_url) = body.image_url {
        if image_url.len() > 500_000 {
            return Err(AppError::BadRequest("Image URL too long".into()));
        }
        sqlx::query("UPDATE draft_nfts SET image_url = ? WHERE id = ?")
            .bind(image_url).bind(&draft_id).execute(&state.pool).await?;
    }
    if let Some(ref metadata_uri) = body.metadata_uri {
        if metadata_uri.len() > 2000 {
            return Err(AppError::BadRequest("Metadata URI too long (max 2000 chars)".into()));
        }
        sqlx::query("UPDATE draft_nfts SET metadata_uri = ? WHERE id = ?")
            .bind(metadata_uri).bind(&draft_id).execute(&state.pool).await?;
    }
    if let Some(ref attributes) = body.attributes {
        if attributes.len() > 10_000 {
            return Err(AppError::BadRequest("Attributes too long (max 10000 chars)".into()));
        }
        sqlx::query("UPDATE draft_nfts SET attributes = ? WHERE id = ?")
            .bind(attributes).bind(&draft_id).execute(&state.pool).await?;
    }

    let updated: DraftNft = sqlx::query_as("SELECT * FROM draft_nfts WHERE id = ?")
        .bind(&draft_id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(updated))
}

// DELETE /api/draft-nfts/{id}
pub async fn delete_draft_nft(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(draft_id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    let draft: DraftNft = sqlx::query_as("SELECT * FROM draft_nfts WHERE id = ?")
        .bind(&draft_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Draft NFT not found".into()))?;

    // Verify creator
    let (work, _project) = load_work_and_check_creator(&state.pool, &draft.work_id, &claims.user_id).await?;

    // Block deletion in locked states
    if ["ready_to_deploy", "deploying", "mint_ready"].contains(&work.status.as_str()) {
        return Err(AppError::BadRequest("Cannot delete draft NFTs in this status".into()));
    }

    // Auto-reset if pending_mint_approval
    auto_reset_on_nft_change(&state.pool, &draft.work_id).await?;

    sqlx::query("DELETE FROM draft_nfts WHERE id = ?")
        .bind(&draft_id)
        .execute(&state.pool)
        .await?;

    Ok(Json(serde_json::json!({ "deleted": true })))
}

// POST /api/works/{id}/submit-for-mint-approval
pub async fn submit_for_mint_approval(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(work_id): Path<String>,
) -> AppResult<Json<Work>> {
    let (work, project) = load_work_and_check_creator(&state.pool, &work_id, &claims.user_id).await?;

    if work.status != "deployed" {
        return Err(AppError::BadRequest("Work must be deployed to submit for mint approval".into()));
    }

    // Must have at least one draft NFT
    let draft_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM draft_nfts WHERE work_id = ?"
    )
    .bind(&work_id)
    .fetch_one(&state.pool)
    .await?;

    if draft_count == 0 {
        return Err(AppError::BadRequest("Add at least one draft NFT before submitting for mint approval".into()));
    }

    // Get active participants
    let work_participants: Vec<Participant> = sqlx::query_as(
        "SELECT p.* FROM participants p
         INNER JOIN allocations a ON p.allocation_id = a.id
         WHERE a.work_id = ? AND p.status NOT IN ('rejected', 'kicked')"
    )
    .bind(&work_id)
    .fetch_all(&state.pool)
    .await?;

    if work_participants.is_empty() {
        // Solo mode: auto-approve → mint_ready
        sqlx::query("UPDATE works SET status = 'mint_ready' WHERE id = ?")
            .bind(&work_id)
            .execute(&state.pool)
            .await?;
    } else {
        // B5-5: Wrap approved_at reset + status change in a single transaction
        {
            let mut tx = state.pool.begin().await?;
            for pt in &work_participants {
                sqlx::query("UPDATE participants SET approved_at = NULL WHERE id = ?")
                    .bind(&pt.id)
                    .execute(&mut *tx)
                    .await?;
            }
            sqlx::query("UPDATE works SET status = 'pending_mint_approval' WHERE id = ?")
                .bind(&work_id)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
        }

        // Notify each participant
        for pt in &work_participants {
            if let Some(ref uid) = pt.user_id {
                let _ = create_notification(
                    &state.pool,
                    &state.notifier,
                    uid,
                    "work_mint_approval_requested",
                    &format!("Mint approval required for \"{}\"", work.name),
                    &format!("The creator of \"{}\" is asking you to approve minting {} NFTs.", project.name, draft_count),
                    Some(&work.project_id),
                    Some(&work_id),
                ).await;
            }
        }

        // Auto-approve bot participants
        let bot_participants: Vec<(String, String)> = {
            let mut bots = Vec::new();
            for pt in &work_participants {
                if let Some(ref uid) = pt.user_id {
                    let is_bot: bool = sqlx::query_scalar::<_, bool>("SELECT is_bot FROM users WHERE id = ?")
                        .bind(uid)
                        .fetch_optional(&state.pool)
                        .await?
                        .unwrap_or(false);
                    if is_bot {
                        bots.push((pt.id.clone(), uid.clone()));
                    }
                }
            }
            bots
        };

        if !bot_participants.is_empty() {
            let pool = state.pool.clone();
            let notifier = state.notifier.clone();
            let work_id_clone = work_id.clone();
            let work_name = work.name.clone();
            let project_id = work.project_id.clone();
            let creator_id = project.creator_id.clone();
            let bot_delay = state.config.bot_delay_secs;

            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(bot_delay)).await;

                for (participant_id, bot_user_id) in &bot_participants {
                    let _ = sqlx::query("UPDATE participants SET approved_at = CURRENT_TIMESTAMP WHERE id = ?")
                        .bind(participant_id)
                        .execute(&pool)
                        .await;

                    let bot_name: String = sqlx::query_scalar("SELECT display_name FROM users WHERE id = ?")
                        .bind(bot_user_id)
                        .fetch_optional(&pool)
                        .await
                        .ok()
                        .flatten()
                        .unwrap_or_else(|| "Bot".to_string());

                    let _ = create_notification(
                        &pool,
                        &notifier,
                        &creator_id,
                        "work_participant_approved",
                        &format!("{} approved minting for \"{}\"", bot_name, work_name),
                        "",
                        Some(&project_id),
                        Some(&work_id_clone),
                    ).await;
                }

                // Check if all participants have now approved
                let not_approved: i64 = sqlx::query_scalar(
                    "SELECT COUNT(*) FROM participants p
                     INNER JOIN allocations a ON p.allocation_id = a.id
                     WHERE a.work_id = ? AND p.status NOT IN ('rejected', 'kicked') AND p.approved_at IS NULL"
                )
                .bind(&work_id_clone)
                .fetch_one(&pool)
                .await
                .unwrap_or(1);

                if not_approved == 0 {
                    let _ = sqlx::query("UPDATE works SET status = 'mint_ready' WHERE id = ?")
                        .bind(&work_id_clone)
                        .execute(&pool)
                        .await;

                    let _ = create_notification(
                        &pool,
                        &notifier,
                        &creator_id,
                        "work_all_approved",
                        &format!("All collaborators approved minting for \"{}\"", work_name),
                        "The NFTs are ready to be minted.",
                        Some(&project_id),
                        Some(&work_id_clone),
                    ).await;
                }
            });
        }
    }

    let updated: Work = sqlx::query_as("SELECT * FROM works WHERE id = ?")
        .bind(&work_id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(updated))
}

// POST /api/works/{id}/publish — make a deployed work publicly accessible via slug
pub async fn publish_work(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(work_id): Path<String>,
) -> AppResult<Json<Work>> {
    let (work, _project) = load_work_and_check_creator(&state.pool, &work_id, &claims.user_id).await?;

    if work.status != "deployed" {
        return Err(AppError::BadRequest("Work must be deployed to publish".into()));
    }

    // B5-2: Generate slug with retry loop to handle UNIQUE constraint collisions
    let base_slug: String = work.name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    let mut last_err = None;
    for _ in 0..3 {
        let suffix: String = format!("{:04x}", rand::thread_rng().gen_range(0u16..=0xFFFFu16));
        let slug = format!("{}-{}", base_slug, suffix);

        // Check for existing slug first
        let existing: Option<String> = sqlx::query_scalar(
            "SELECT id FROM works WHERE public_slug = ? AND id != ?"
        )
        .bind(&slug)
        .bind(&work_id)
        .fetch_optional(&state.pool)
        .await?;

        if existing.is_some() {
            last_err = Some(slug);
            continue;
        }

        sqlx::query("UPDATE works SET is_public = 1, public_slug = ? WHERE id = ?")
            .bind(&slug)
            .bind(&work_id)
            .execute(&state.pool)
            .await?;

        let updated: Work = sqlx::query_as("SELECT * FROM works WHERE id = ?")
            .bind(&work_id)
            .fetch_one(&state.pool)
            .await?;

        return Ok(Json(updated));
    }

    Err(AppError::Internal(format!(
        "Failed to generate unique slug after 3 attempts (last collision: {})",
        last_err.unwrap_or_default()
    )))
}

// POST /api/works/{id}/unpublish — remove public access
pub async fn unpublish_work(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(work_id): Path<String>,
) -> AppResult<Json<Work>> {
    let (work, _project) = load_work_and_check_creator(&state.pool, &work_id, &claims.user_id).await?;

    if !work.is_public {
        return Err(AppError::BadRequest("Work is not published".into()));
    }

    sqlx::query("UPDATE works SET is_public = 0, public_slug = NULL WHERE id = ?")
        .bind(&work_id)
        .execute(&state.pool)
        .await?;

    let updated: Work = sqlx::query_as("SELECT * FROM works WHERE id = ?")
        .bind(&work_id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(updated))
}

// PUT /api/works/{id}/contracts — update contract addresses
#[derive(Deserialize)]
pub struct UpdateContracts {
    pub contract_nft_address: Option<String>,
    pub contract_splitter_address: Option<String>,
    pub contract_vault_address: Option<String>,
}

pub async fn update_contracts(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(work_id): Path<String>,
    Json(body): Json<UpdateContracts>,
) -> AppResult<Json<Work>> {
    let (work, _project) = load_work_and_check_creator(&state.pool, &work_id, &claims.user_id).await?;

    if work.contract_nft_address.is_some() {
        return Err(AppError::BadRequest("Cannot overwrite deployed contract addresses".into()));
    }
    if work.status != "deploying" && work.status != "ready_to_deploy" {
        return Err(AppError::BadRequest("Cannot set contract addresses in this status".into()));
    }

    // Validate Ethereum address format
    fn validate_eth_address(addr: &str) -> bool {
        let a = addr.to_lowercase();
        a.starts_with("0x") && a.len() == 42 && hex::decode(&a[2..]).is_ok()
    }

    if let Some(ref addr) = body.contract_nft_address {
        if !validate_eth_address(addr) {
            return Err(AppError::BadRequest("Invalid NFT contract address format".into()));
        }
        sqlx::query("UPDATE works SET contract_nft_address = ? WHERE id = ?")
            .bind(addr)
            .bind(&work_id)
            .execute(&state.pool)
            .await?;
    }
    if let Some(ref addr) = body.contract_splitter_address {
        if !validate_eth_address(addr) {
            return Err(AppError::BadRequest("Invalid splitter contract address format".into()));
        }
        sqlx::query("UPDATE works SET contract_splitter_address = ? WHERE id = ?")
            .bind(addr)
            .bind(&work_id)
            .execute(&state.pool)
            .await?;
    }
    if let Some(ref addr) = body.contract_vault_address {
        if !validate_eth_address(addr) {
            return Err(AppError::BadRequest("Invalid vault contract address format".into()));
        }
        sqlx::query("UPDATE works SET contract_vault_address = ? WHERE id = ?")
            .bind(addr)
            .bind(&work_id)
            .execute(&state.pool)
            .await?;
    }

    let updated: Work = sqlx::query_as("SELECT * FROM works WHERE id = ?")
        .bind(&work_id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(updated))
}
