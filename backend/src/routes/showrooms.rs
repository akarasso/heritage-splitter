use axum::{extract::{State, Path}, Extension, Json};
use serde::Serialize;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::middleware::Claims;
use crate::models::{Showroom, CreateShowroom, UpdateShowroom, ShowroomParticipant, InviteToShowroom, ShowroomListing, CreateShowroomListing, UpdateShowroomListing, User, ProposeCollection, BatchMarginUpdate, Nft, Collection};
use crate::services::blockchain;
use crate::AppState;

/// Collection with project name for display
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct CollectionWithProject {
    #[sqlx(flatten)]
    #[serde(flatten)]
    pub collection: Collection,
    pub project_name: String,
}

/// Convert AVAX price string (e.g. "1.5") to wei string for storage
fn avax_to_wei_string(price_str: &str) -> String {
    let trimmed = price_str.trim();
    if trimmed.is_empty() {
        return "0".into();
    }
    let parts: Vec<&str> = trimmed.split('.').collect();
    let integer_part: u128 = parts[0].parse().unwrap_or(0);
    let decimals = if parts.len() == 2 { parts[1] } else { "" };
    let padded = format!("{:0<18}", &decimals[..decimals.len().min(18)]);
    let frac_part: u128 = padded.parse().unwrap_or(0);
    let wei = integer_part
        .saturating_mul(1_000_000_000_000_000_000u128)
        .saturating_add(frac_part);
    wei.to_string()
}

#[derive(Serialize)]
pub struct ShowroomDetail {
    #[serde(flatten)]
    pub showroom: Showroom,
    pub participants: Vec<ShowroomParticipantDetail>,
    pub listings: Vec<ShowroomListingResponse>,
}

#[derive(Serialize)]
pub struct ShowroomParticipantDetail {
    #[serde(flatten)]
    pub participant: ShowroomParticipant,
    pub display_name: String,
    pub wallet_address: String,
}

#[derive(Serialize)]
pub struct ShowroomListingResponse {
    #[serde(flatten)]
    pub listing: ShowroomListing,
    pub proposed_by_name: String,
}

/// Helper: load showroom and verify creator
async fn load_showroom_check_owner(
    pool: &sqlx::SqlitePool,
    showroom_id: &str,
    user_id: &str,
) -> AppResult<Showroom> {
    let showroom: Showroom = sqlx::query_as("SELECT * FROM showrooms WHERE id = ?")
        .bind(showroom_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Showroom not found".into()))?;

    if showroom.creator_id != user_id {
        return Err(AppError::Forbidden("Not showroom owner".into()));
    }
    Ok(showroom)
}

// POST /api/showrooms
pub async fn create_showroom(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Json(body): Json<CreateShowroom>,
) -> AppResult<Json<Showroom>> {
    if body.name.len() > 200 {
        return Err(AppError::BadRequest("Name cannot exceed 200 characters".into()));
    }
    if body.description.len() > 5000 {
        return Err(AppError::BadRequest("Description cannot exceed 5000 characters".into()));
    }
    let showroom = Showroom::new(claims.user_id.clone(), body);

    sqlx::query(
        "INSERT INTO showrooms (id, name, description, status, creator_id, public_slug, is_public, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&showroom.id)
    .bind(&showroom.name)
    .bind(&showroom.description)
    .bind(&showroom.status)
    .bind(&showroom.creator_id)
    .bind(&showroom.public_slug)
    .bind(&showroom.is_public)
    .bind(&showroom.created_at)
    .execute(&state.pool)
    .await?;

    Ok(Json(showroom))
}

// GET /api/showrooms
pub async fn list_showrooms(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
) -> AppResult<Json<Vec<Showroom>>> {
    let showrooms: Vec<Showroom> = sqlx::query_as(
        "SELECT DISTINCT s.* FROM showrooms s
         LEFT JOIN showroom_participants sp ON sp.showroom_id = s.id
         WHERE s.creator_id = ? OR (sp.user_id = ? AND sp.status = 'accepted')
         ORDER BY s.created_at DESC
         LIMIT 100"
    )
    .bind(&claims.user_id)
    .bind(&claims.user_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(showrooms))
}

// GET /api/showrooms/{id}
pub async fn get_showroom(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<ShowroomDetail>> {
    let showroom: Showroom = sqlx::query_as("SELECT * FROM showrooms WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Showroom not found".into()))?;

    // Must be creator or participant
    let is_participant: bool = sqlx::query_scalar(
        "SELECT COUNT(*) > 0 FROM showroom_participants WHERE showroom_id = ? AND user_id = ? AND status = 'accepted'"
    )
    .bind(&id)
    .bind(&claims.user_id)
    .fetch_one(&state.pool)
    .await?;

    if showroom.creator_id != claims.user_id && !is_participant {
        return Err(AppError::Forbidden("Not authorized".into()));
    }

    let participants: Vec<ShowroomParticipant> = sqlx::query_as(
        "SELECT * FROM showroom_participants WHERE showroom_id = ? ORDER BY invited_at"
    )
    .bind(&id)
    .fetch_all(&state.pool)
    .await?;

    let mut participant_details = Vec::new();
    for p in participants {
        let user: User = sqlx::query_as("SELECT * FROM users WHERE id = ?")
            .bind(&p.user_id)
            .fetch_one(&state.pool)
            .await?;
        participant_details.push(ShowroomParticipantDetail {
            participant: p,
            display_name: user.display_name,
            wallet_address: user.wallet_address,
        });
    }

    let listings: Vec<ShowroomListing> = sqlx::query_as(
        "SELECT * FROM showroom_listings WHERE showroom_id = ? ORDER BY created_at"
    )
    .bind(&id)
    .fetch_all(&state.pool)
    .await?;

    // Build user_id -> display_name map for proposers
    let mut user_names: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for pd in &participant_details {
        user_names.insert(pd.participant.user_id.clone(), pd.display_name.clone());
    }
    // Also include the showroom creator
    if !user_names.contains_key(&showroom.creator_id) {
        let creator: User = sqlx::query_as("SELECT * FROM users WHERE id = ?")
            .bind(&showroom.creator_id)
            .fetch_one(&state.pool)
            .await?;
        user_names.insert(showroom.creator_id.clone(), creator.display_name);
    }
    // Look up any proposers not yet in the map
    let mut missing_ids: Vec<String> = Vec::new();
    for l in &listings {
        if !user_names.contains_key(&l.proposed_by) && !missing_ids.contains(&l.proposed_by) {
            missing_ids.push(l.proposed_by.clone());
        }
    }
    for uid in &missing_ids {
        if let Ok(u) = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = ?")
            .bind(uid)
            .fetch_one(&state.pool)
            .await
        {
            user_names.insert(uid.clone(), u.display_name);
        }
    }

    let listing_responses: Vec<ShowroomListingResponse> = listings.into_iter().map(|l| {
        let name = user_names.get(&l.proposed_by).cloned().unwrap_or_default();
        ShowroomListingResponse { listing: l, proposed_by_name: name }
    }).collect();

    Ok(Json(ShowroomDetail {
        showroom,
        participants: participant_details,
        listings: listing_responses,
    }))
}

// PUT /api/showrooms/{id}
pub async fn update_showroom(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateShowroom>,
) -> AppResult<Json<Showroom>> {
    let showroom = load_showroom_check_owner(&state.pool, &id, &claims.user_id).await?;

    if showroom.status != "draft" {
        return Err(AppError::BadRequest("Can only edit draft showrooms".into()));
    }

    let name = body.name.unwrap_or(showroom.name);
    let description = body.description.unwrap_or(showroom.description);
    if name.len() > 200 {
        return Err(AppError::BadRequest("Name cannot exceed 200 characters".into()));
    }
    if description.len() > 5000 {
        return Err(AppError::BadRequest("Description cannot exceed 5000 characters".into()));
    }

    sqlx::query("UPDATE showrooms SET name = ?, description = ? WHERE id = ?")
        .bind(&name)
        .bind(&description)
        .bind(&id)
        .execute(&state.pool)
        .await?;

    let updated: Showroom = sqlx::query_as("SELECT * FROM showrooms WHERE id = ?")
        .bind(&id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(updated))
}

// POST /api/showrooms/{id}/invite
pub async fn invite_to_showroom(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<InviteToShowroom>,
) -> AppResult<Json<ShowroomParticipant>> {
    load_showroom_check_owner(&state.pool, &id, &claims.user_id).await?;

    // Check user exists
    let _user: User = sqlx::query_as("SELECT * FROM users WHERE id = ?")
        .bind(&body.user_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".into()))?;

    let now = chrono::Utc::now().naive_utc();
    let participant = ShowroomParticipant {
        id: Uuid::new_v4().to_string(),
        showroom_id: id.clone(),
        user_id: body.user_id.clone(),
        status: "accepted".into(),
        invited_at: now,
        accepted_at: Some(now),
    };

    sqlx::query(
        "INSERT INTO showroom_participants (id, showroom_id, user_id, status, invited_at, accepted_at)
         VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(&participant.id)
    .bind(&participant.showroom_id)
    .bind(&participant.user_id)
    .bind(&participant.status)
    .bind(&participant.invited_at)
    .bind(&participant.accepted_at)
    .execute(&state.pool)
    .await?;

    Ok(Json(participant))
}

// POST /api/showrooms/{id}/accept
pub async fn accept_showroom_invite(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<ShowroomParticipant>> {
    let participant: ShowroomParticipant = sqlx::query_as(
        "SELECT * FROM showroom_participants WHERE showroom_id = ? AND user_id = ?"
    )
    .bind(&id)
    .bind(&claims.user_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Invitation not found".into()))?;

    if participant.status != "invited" {
        return Err(AppError::BadRequest("Invitation already processed".into()));
    }

    let now = chrono::Utc::now().naive_utc();
    sqlx::query(
        "UPDATE showroom_participants SET status = 'accepted', accepted_at = ? WHERE id = ?"
    )
    .bind(&now)
    .bind(&participant.id)
    .execute(&state.pool)
    .await?;

    let updated: ShowroomParticipant = sqlx::query_as(
        "SELECT * FROM showroom_participants WHERE id = ?"
    )
    .bind(&participant.id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(updated))
}

// DELETE /api/showrooms/{id}/participants/{user_id}
pub async fn remove_showroom_participant(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path((id, participant_user_id)): Path<(String, String)>,
) -> AppResult<Json<serde_json::Value>> {
    load_showroom_check_owner(&state.pool, &id, &claims.user_id).await?;

    let result = sqlx::query(
        "DELETE FROM showroom_participants WHERE showroom_id = ? AND user_id = ?"
    )
    .bind(&id)
    .bind(&participant_user_id)
    .execute(&state.pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Participant not found".into()));
    }

    Ok(Json(serde_json::json!({ "removed": true })))
}

// POST /api/showrooms/{id}/listings
pub async fn create_showroom_listing(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<CreateShowroomListing>,
) -> AppResult<Json<ShowroomListing>> {
    // Must be creator or accepted participant
    let showroom: Showroom = sqlx::query_as("SELECT * FROM showrooms WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Showroom not found".into()))?;

    let is_participant: bool = sqlx::query_scalar(
        "SELECT COUNT(*) > 0 FROM showroom_participants WHERE showroom_id = ? AND user_id = ? AND status = 'accepted'"
    )
    .bind(&id)
    .bind(&claims.user_id)
    .fetch_one(&state.pool)
    .await?;

    if showroom.creator_id != claims.user_id && !is_participant {
        return Err(AppError::Forbidden("Not authorized to propose listings".into()));
    }

    // Validate nft_contract format
    if !body.nft_contract.starts_with("0x") || body.nft_contract.len() != 42 {
        return Err(AppError::BadRequest("Invalid nft_contract: must be 0x-prefixed 42-character address".into()));
    }
    // Validate base_price format
    if !body.base_price.is_empty() && body.base_price.trim().parse::<f64>().is_err() {
        return Err(AppError::BadRequest("Invalid base_price: must be a valid decimal number".into()));
    }

    let listing = ShowroomListing {
        id: Uuid::new_v4().to_string(),
        showroom_id: id.clone(),
        nft_contract: body.nft_contract,
        token_id: body.token_id,
        base_price: body.base_price,
        margin: "0".into(),
        proposed_by: claims.user_id.clone(),
        status: "proposed".into(),
        title: String::new(),
        image_url: String::new(),
        artist_name: String::new(),
        collection_id: None,
        collection_name: String::new(),
        created_at: chrono::Utc::now().naive_utc(),
    };

    sqlx::query(
        "INSERT INTO showroom_listings (id, showroom_id, nft_contract, token_id, base_price, margin, proposed_by, status, title, image_url, artist_name, collection_id, collection_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&listing.id)
    .bind(&listing.showroom_id)
    .bind(&listing.nft_contract)
    .bind(&listing.token_id)
    .bind(&listing.base_price)
    .bind(&listing.margin)
    .bind(&listing.proposed_by)
    .bind(&listing.status)
    .bind(&listing.title)
    .bind(&listing.image_url)
    .bind(&listing.artist_name)
    .bind(&listing.collection_id)
    .bind(&listing.collection_name)
    .bind(&listing.created_at)
    .execute(&state.pool)
    .await?;

    Ok(Json(listing))
}

// PUT /api/showroom-listings/{id}
pub async fn update_showroom_listing(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateShowroomListing>,
) -> AppResult<Json<ShowroomListing>> {
    let listing: ShowroomListing = sqlx::query_as(
        "SELECT * FROM showroom_listings WHERE id = ?"
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Listing not found".into()))?;

    // Only showroom owner can set margin/approve
    load_showroom_check_owner(&state.pool, &listing.showroom_id, &claims.user_id).await?;

    if let Some(margin) = &body.margin {
        // Validate margin is a valid AVAX amount (decimal number, max 1000 AVAX)
        let trimmed = margin.trim();
        if trimmed.is_empty() || trimmed.parse::<f64>().is_err() {
            return Err(AppError::BadRequest("Invalid margin format. Must be a decimal number (e.g. '0.5')".into()));
        }
        let margin_f64: f64 = trimmed.parse().unwrap_or(0.0);
        if margin_f64 < 0.0 {
            return Err(AppError::BadRequest("Margin cannot be negative".into()));
        }
        if margin_f64 > 1000.0 {
            return Err(AppError::BadRequest("Margin cannot exceed 1000 AVAX".into()));
        }
        sqlx::query("UPDATE showroom_listings SET margin = ? WHERE id = ?")
            .bind(margin)
            .bind(&id)
            .execute(&state.pool)
            .await?;

        // If the showroom is deployed, update margin on-chain too
        let showroom: Showroom = sqlx::query_as("SELECT * FROM showrooms WHERE id = ?")
            .bind(&listing.showroom_id)
            .fetch_one(&state.pool)
            .await?;
        if let Some(contract_address) = &showroom.contract_address {
            if showroom.status == "active" {
                blockchain::set_showroom_margin(
                    &state.config.avalanche_rpc_url,
                    &state.config.certifier_private_key,
                    contract_address,
                    &listing.nft_contract,
                    listing.token_id as u64,
                    margin,
                ).await.map_err(|e| AppError::Internal(format!("On-chain setMargin failed: {e}")))?;
            }
        }
    }

    if let Some(status) = &body.status {
        const VALID_LISTING_STATUSES: &[&str] = &["proposed", "approved", "hidden"];
        if !VALID_LISTING_STATUSES.contains(&status.as_str()) {
            return Err(AppError::BadRequest(format!("Invalid listing status '{}'. Must be one of: proposed, approved, hidden", status)));
        }
        sqlx::query("UPDATE showroom_listings SET status = ? WHERE id = ?")
            .bind(status)
            .bind(&id)
            .execute(&state.pool)
            .await?;
    }

    let updated: ShowroomListing = sqlx::query_as(
        "SELECT * FROM showroom_listings WHERE id = ?"
    )
    .bind(&id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(updated))
}

// DELETE /api/showroom-listings/{id}
pub async fn delete_showroom_listing(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    let listing: ShowroomListing = sqlx::query_as(
        "SELECT * FROM showroom_listings WHERE id = ?"
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Listing not found".into()))?;

    // Owner or proposer can delete
    let showroom: Showroom = sqlx::query_as("SELECT * FROM showrooms WHERE id = ?")
        .bind(&listing.showroom_id)
        .fetch_one(&state.pool)
        .await?;

    if showroom.creator_id != claims.user_id && listing.proposed_by != claims.user_id {
        return Err(AppError::Forbidden("Not authorized".into()));
    }

    sqlx::query("DELETE FROM showroom_listings WHERE id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await?;

    Ok(Json(serde_json::json!({ "deleted": true })))
}

// POST /api/showrooms/{id}/deploy
pub async fn deploy_showroom(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<Showroom>> {
    let showroom = load_showroom_check_owner(&state.pool, &id, &claims.user_id).await?;

    if showroom.status != "draft" {
        return Err(AppError::BadRequest("Showroom already deployed".into()));
    }

    // Get the producer's wallet address
    let creator: User = sqlx::query_as("SELECT * FROM users WHERE id = ?")
        .bind(&showroom.creator_id)
        .fetch_one(&state.pool)
        .await?;

    if creator.wallet_address.is_empty() {
        return Err(AppError::BadRequest("Producer has no wallet address".into()));
    }

    // Get all non-hidden listings
    let listings: Vec<ShowroomListing> = sqlx::query_as(
        "SELECT * FROM showroom_listings WHERE showroom_id = ? AND status != 'hidden' ORDER BY created_at"
    )
    .bind(&id)
    .fetch_all(&state.pool)
    .await?;

    // Build deploy items from listings
    let mut deploy_items: Vec<blockchain::ShowroomDeployItem> = Vec::new();

    for listing in &listings {
        // Need collection_id to look up market address
        let collection_id = match &listing.collection_id {
            Some(cid) => cid,
            None => continue, // skip listings without collection_id
        };

        // Get collection's market address
        let market_address: Option<String> = sqlx::query_scalar(
            "SELECT contract_market_address FROM collections WHERE id = ?"
        )
        .bind(collection_id)
        .fetch_optional(&state.pool)
        .await?
        .flatten();

        let market_address = match market_address {
            Some(addr) if !addr.is_empty() => addr,
            _ => continue, // skip if no market address
        };

        // Find the market listing ID on-chain
        let listing_info = blockchain::get_listing_for_token(
            &state.config.avalanche_rpc_url,
            &market_address,
            &listing.nft_contract,
            listing.token_id as u64,
        )
        .await
        .ok()
        .flatten();

        match listing_info {
            Some((market_listing_id, true)) => {
                // Active listing found
                deploy_items.push(blockchain::ShowroomDeployItem {
                    nft_contract: listing.nft_contract.clone(),
                    token_id: listing.token_id as u64,
                    market_address: market_address.clone(),
                    market_listing_id,
                    margin_wei: listing.margin.clone(),
                });
            }
            _ => continue, // skip inactive or not-found listings
        }
    }

    // Deploy Showroom contract on-chain with items
    let contract_address = blockchain::deploy_showroom(
        &state.config.avalanche_rpc_url,
        &state.config.certifier_private_key,
        &creator.wallet_address,
        &state.config.registry_address,
        deploy_items,
    )
    .await
    .map_err(|e| AppError::Internal(format!("Showroom deployment failed: {}", e)))?;

    // Update DB: set contract_address, status='active'
    sqlx::query("UPDATE showrooms SET status = 'active', contract_address = ? WHERE id = ?")
        .bind(&contract_address)
        .bind(&id)
        .execute(&state.pool)
        .await?;

    let updated: Showroom = sqlx::query_as("SELECT * FROM showrooms WHERE id = ?")
        .bind(&id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(updated))
}

// POST /api/showrooms/{id}/propose-collection
pub async fn propose_collection(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<ProposeCollection>,
) -> AppResult<Json<Vec<ShowroomListing>>> {
    // Check user is accepted participant or creator of the showroom
    let showroom: Showroom = sqlx::query_as("SELECT * FROM showrooms WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Showroom not found".into()))?;

    let is_participant: bool = sqlx::query_scalar(
        "SELECT COUNT(*) > 0 FROM showroom_participants WHERE showroom_id = ? AND user_id = ? AND status = 'accepted'"
    )
    .bind(&id)
    .bind(&claims.user_id)
    .fetch_one(&state.pool)
    .await?;

    if showroom.creator_id != claims.user_id && !is_participant {
        return Err(AppError::Forbidden("Not authorized to propose listings".into()));
    }

    // Fetch the collection and verify it's deployed
    let collection: Collection = sqlx::query_as("SELECT * FROM collections WHERE id = ?")
        .bind(&body.collection_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Collection not found".into()))?;

    if collection.contract_nft_address.is_none() {
        return Err(AppError::BadRequest("Collection is not deployed".into()));
    }

    // Verify user is a participant of the collection's project
    let is_project_member: bool = sqlx::query_scalar(
        "SELECT COUNT(*) > 0 FROM projects WHERE id = ? AND creator_id = ?"
    )
    .bind(&collection.project_id)
    .bind(&claims.user_id)
    .fetch_one(&state.pool)
    .await?;

    let is_project_participant: bool = sqlx::query_scalar(
        "SELECT COUNT(*) > 0 FROM participants WHERE project_id = ? AND user_id = ? AND status = 'accepted'"
    )
    .bind(&collection.project_id)
    .bind(&claims.user_id)
    .fetch_one(&state.pool)
    .await?;

    if !is_project_member && !is_project_participant {
        return Err(AppError::Forbidden("Not a member of the collection's project".into()));
    }

    // Fetch all minted NFTs for this collection
    let nfts: Vec<Nft> = sqlx::query_as(
        "SELECT * FROM nfts WHERE collection_id = ? ORDER BY token_id"
    )
    .bind(&body.collection_id)
    .fetch_all(&state.pool)
    .await?;

    if nfts.is_empty() {
        return Err(AppError::BadRequest("Collection has no minted NFTs".into()));
    }

    let nft_contract = collection.contract_nft_address.unwrap();

    // Filter out sold/delisted NFTs by checking on-chain market status
    let active_tokens = if let Some(ref market_addr) = collection.contract_market_address {
        blockchain::get_active_token_ids(
            &state.config.avalanche_rpc_url,
            market_addr,
            &nft_contract,
        ).await.unwrap_or_default()
    } else {
        // No market → include all NFTs
        nfts.iter().map(|n| n.token_id as u64).collect()
    };

    let available_nfts: Vec<&Nft> = nfts.iter()
        .filter(|n| active_tokens.contains(&(n.token_id as u64)))
        .collect();

    if available_nfts.is_empty() {
        return Err(AppError::BadRequest("No available NFTs in this collection (all sold or delisted)".into()));
    }

    // Fetch project name for display
    let project_name: String = sqlx::query_scalar("SELECT name FROM projects WHERE id = ?")
        .bind(&collection.project_id)
        .fetch_one(&state.pool)
        .await?;

    let now = chrono::Utc::now().naive_utc();
    let collection_name = format!("{} - {}", project_name, collection.name);
    let mut created_listings = Vec::new();

    for nft in &available_nfts {
        let listing = ShowroomListing {
            id: Uuid::new_v4().to_string(),
            showroom_id: id.clone(),
            nft_contract: nft_contract.clone(),
            token_id: nft.token_id,
            base_price: avax_to_wei_string(&nft.price),
            margin: "0".into(),
            proposed_by: claims.user_id.clone(),
            status: "proposed".into(),
            title: nft.title.clone(),
            image_url: nft.image_url.clone(),
            artist_name: nft.artist_name.clone(),
            collection_id: Some(body.collection_id.clone()),
            collection_name: collection_name.clone(),
            created_at: now,
        };

        sqlx::query(
            "INSERT INTO showroom_listings (id, showroom_id, nft_contract, token_id, base_price, margin, proposed_by, status, title, image_url, artist_name, collection_id, collection_name)
             VALUES (?, ?, ?, ?, ?, '0', ?, 'proposed', ?, ?, ?, ?, ?)"
        )
        .bind(&listing.id)
        .bind(&listing.showroom_id)
        .bind(&listing.nft_contract)
        .bind(&listing.token_id)
        .bind(&listing.base_price)
        .bind(&listing.proposed_by)
        .bind(&listing.title)
        .bind(&listing.image_url)
        .bind(&listing.artist_name)
        .bind(&listing.collection_id)
        .bind(&listing.collection_name)
        .execute(&state.pool)
        .await?;

        created_listings.push(listing);
    }

    Ok(Json(created_listings))
}

// GET /api/showrooms/{id}/my-collections
pub async fn list_proposable_collections(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<Vec<CollectionWithProject>>> {
    // Verify user is participant or creator of the showroom
    let showroom: Showroom = sqlx::query_as("SELECT * FROM showrooms WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Showroom not found".into()))?;

    let is_participant: bool = sqlx::query_scalar(
        "SELECT COUNT(*) > 0 FROM showroom_participants WHERE showroom_id = ? AND user_id = ? AND status = 'accepted'"
    )
    .bind(&id)
    .bind(&claims.user_id)
    .fetch_one(&state.pool)
    .await?;

    if showroom.creator_id != claims.user_id && !is_participant {
        return Err(AppError::Forbidden("Not authorized".into()));
    }

    // Get deployed collections from user's projects, excluding already proposed ones
    let collections: Vec<CollectionWithProject> = sqlx::query_as(
        "SELECT DISTINCT c.*, p.name as project_name FROM collections c
         INNER JOIN projects p ON p.id = c.project_id
         LEFT JOIN participants pt ON pt.project_id = p.id AND pt.user_id = ? AND pt.status = 'accepted'
         WHERE (p.creator_id = ? OR pt.id IS NOT NULL)
         AND c.contract_nft_address IS NOT NULL
         AND c.id NOT IN (SELECT DISTINCT collection_id FROM showroom_listings WHERE showroom_id = ? AND collection_id IS NOT NULL)
         ORDER BY c.created_at DESC"
    )
    .bind(&claims.user_id)
    .bind(&claims.user_id)
    .bind(&id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(collections))
}

// PUT /api/showrooms/{id}/batch-margin
pub async fn batch_update_margin(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<BatchMarginUpdate>,
) -> AppResult<Json<serde_json::Value>> {
    let showroom = load_showroom_check_owner(&state.pool, &id, &claims.user_id).await?;

    // Validate margin format (same rules as single update)
    let trimmed = body.margin.trim();
    if trimmed.is_empty() || trimmed.parse::<f64>().is_err() {
        return Err(AppError::BadRequest("Invalid margin format. Must be a decimal number (e.g. '0.5')".into()));
    }
    let margin_f64: f64 = trimmed.parse().unwrap_or(0.0);
    if margin_f64 < 0.0 {
        return Err(AppError::BadRequest("Margin cannot be negative".into()));
    }
    if margin_f64 > 1000.0 {
        return Err(AppError::BadRequest("Margin cannot exceed 1000 AVAX".into()));
    }

    for listing_id in &body.listing_ids {
        sqlx::query("UPDATE showroom_listings SET margin = ? WHERE id = ? AND showroom_id = ?")
            .bind(&body.margin)
            .bind(listing_id)
            .bind(&id)
            .execute(&state.pool)
            .await?;
    }

    // If deployed, update margins on-chain
    if let Some(contract_address) = &showroom.contract_address {
        if showroom.status == "active" {
            for listing_id in &body.listing_ids {
                let listing: Option<ShowroomListing> = sqlx::query_as(
                    "SELECT * FROM showroom_listings WHERE id = ? AND showroom_id = ?"
                )
                .bind(listing_id)
                .bind(&id)
                .fetch_optional(&state.pool)
                .await?;

                if let Some(listing) = listing {
                    blockchain::set_showroom_margin(
                        &state.config.avalanche_rpc_url,
                        &state.config.certifier_private_key,
                        contract_address,
                        &listing.nft_contract,
                        listing.token_id as u64,
                        &body.margin,
                    ).await.map_err(|e| AppError::Internal(format!("On-chain setMargin failed: {e}")))?;
                }
            }
        }
    }

    Ok(Json(serde_json::json!({ "updated": body.listing_ids.len() })))
}

// DELETE /api/showrooms/{id}/collections/{collection_id}
pub async fn unshare_collection(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path((id, collection_id)): Path<(String, String)>,
) -> AppResult<Json<serde_json::Value>> {
    // Check user is showroom owner or the proposer of those listings
    let showroom: Showroom = sqlx::query_as("SELECT * FROM showrooms WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Showroom not found".into()))?;

    let is_owner = showroom.creator_id == claims.user_id;

    // Check if user proposed this collection's listings
    let proposed_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM showroom_listings WHERE showroom_id = ? AND collection_id = ? AND proposed_by = ?"
    )
    .bind(&id)
    .bind(&collection_id)
    .bind(&claims.user_id)
    .fetch_one(&state.pool)
    .await?;

    if !is_owner && proposed_count == 0 {
        return Err(AppError::Forbidden("Not authorized to unshare this collection".into()));
    }

    let result = sqlx::query(
        "DELETE FROM showroom_listings WHERE showroom_id = ? AND collection_id = ?"
    )
    .bind(&id)
    .bind(&collection_id)
    .execute(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({ "removed": result.rows_affected() })))
}

fn generate_slug(name: &str) -> String {
    let slug: String = name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    // Remove consecutive hyphens and trim
    let mut result = String::new();
    let mut prev_hyphen = false;
    for c in slug.chars() {
        if c == '-' {
            if !prev_hyphen && !result.is_empty() {
                result.push(c);
                prev_hyphen = true;
            }
        } else {
            result.push(c);
            prev_hyphen = false;
        }
    }
    result.trim_end_matches('-').to_string()
}

// POST /api/showrooms/{id}/publish
pub async fn publish_showroom(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<Showroom>> {
    let showroom = load_showroom_check_owner(&state.pool, &id, &claims.user_id).await?;

    if showroom.status != "active" {
        return Err(AppError::BadRequest("Can only publish active showrooms".into()));
    }

    let slug = generate_slug(&showroom.name);

    sqlx::query("UPDATE showrooms SET public_slug = ?, is_public = 1 WHERE id = ?")
        .bind(&slug)
        .bind(&id)
        .execute(&state.pool)
        .await?;

    let updated: Showroom = sqlx::query_as("SELECT * FROM showrooms WHERE id = ?")
        .bind(&id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(updated))
}

// POST /api/showrooms/{id}/unpublish
pub async fn unpublish_showroom(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<Showroom>> {
    load_showroom_check_owner(&state.pool, &id, &claims.user_id).await?;

    sqlx::query("UPDATE showrooms SET is_public = 0 WHERE id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await?;

    let updated: Showroom = sqlx::query_as("SELECT * FROM showrooms WHERE id = ?")
        .bind(&id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(updated))
}
