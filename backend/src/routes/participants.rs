use axum::{extract::{State, Path}, Extension, Json};
use sqlx::Acquire;

use crate::error::{AppError, AppResult};
use crate::middleware::Claims;
use crate::models::{Participant, CreateParticipant, UpdateParticipant, Project, Allocation};
use crate::routes::allocations::recompute_allocation_shares;
use crate::services::notifications::create_notification;
use crate::AppState;

pub async fn add_participant(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(body): Json<CreateParticipant>,
) -> AppResult<Json<Participant>> {
    let project: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
        .bind(&project_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".into()))?;

    if project.creator_id != claims.user_id {
        return Err(AppError::Forbidden("Not project creator".into()));
    }

    // Check max_participants if set
    if let Some(max) = project.max_participants {
        let current_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM participants WHERE project_id = ? AND status NOT IN ('rejected', 'kicked')"
        )
        .bind(&project_id)
        .fetch_one(&state.pool)
        .await?;
        if current_count >= max {
            return Err(AppError::BadRequest(
                format!("Project participant limit reached ({}/{})", current_count, max)
            ));
        }
    }

    // Resolve wallet_address from user_id if provided
    let resolved_wallet = if let Some(ref uid) = body.user_id {
        let wallet: Option<String> = sqlx::query_scalar(
            "SELECT wallet_address FROM users WHERE id = ?"
        )
        .bind(uid)
        .fetch_optional(&state.pool)
        .await?;
        wallet.ok_or_else(|| AppError::NotFound("User not found".into()))?.to_lowercase()
    } else if !body.wallet_address.is_empty() {
        let w = body.wallet_address.to_lowercase();
        if !w.starts_with("0x") || w.len() != 42 || hex::decode(&w[2..]).is_err() {
            return Err(AppError::BadRequest("Invalid Ethereum address format".into()));
        }
        w
    } else {
        return Err(AppError::BadRequest("wallet_address or user_id required".into()));
    };

    // Prevent self-invitation
    if resolved_wallet.to_lowercase() == claims.sub.to_lowercase() {
        return Err(AppError::BadRequest("You cannot invite yourself".into()));
    }

    let mut participant = Participant::new(project_id, body);
    participant.wallet_address = resolved_wallet.to_lowercase();

    // Use transaction to prevent race conditions on max_slots and duplicates
    let mut tx = state.pool.begin().await?;

    // Validate allocation if provided
    if let Some(ref allocation_id) = participant.allocation_id {
        let allocation: Allocation = sqlx::query_as("SELECT * FROM allocations WHERE id = ? AND project_id = ?")
            .bind(allocation_id)
            .bind(&participant.project_id)
            .fetch_optional(tx.acquire().await?)
            .await?
            .ok_or_else(|| AppError::NotFound("Allocation not found".into()))?;

        // Check max_slots
        if let Some(max) = allocation.max_slots {
            let count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM participants WHERE allocation_id = ? AND status NOT IN ('rejected', 'kicked')"
            )
            .bind(allocation_id)
            .fetch_one(tx.acquire().await?)
            .await?;
            if count >= max {
                return Err(AppError::BadRequest(
                    format!("Allocation full ({}/{})", count, max)
                ));
            }
        }
    }

    // Prevent duplicate invitation
    let existing: Option<String> = if let Some(ref alloc_id) = participant.allocation_id {
        sqlx::query_scalar(
            "SELECT id FROM participants WHERE project_id = ? AND wallet_address = ? AND allocation_id = ? AND status NOT IN ('rejected', 'kicked')"
        )
        .bind(&participant.project_id)
        .bind(&participant.wallet_address)
        .bind(alloc_id)
        .fetch_optional(tx.acquire().await?)
        .await?
    } else {
        sqlx::query_scalar(
            "SELECT id FROM participants WHERE project_id = ? AND wallet_address = ? AND allocation_id IS NULL AND status NOT IN ('rejected', 'kicked')"
        )
        .bind(&participant.project_id)
        .bind(&participant.wallet_address)
        .fetch_optional(tx.acquire().await?)
        .await?
    };
    if existing.is_some() {
        return Err(AppError::BadRequest("This user is already a participant or invited in this share".into()));
    }

    // Link to existing user if wallet matches (case-insensitive — wallets stored mixed-case in users table)
    let user_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM users WHERE LOWER(wallet_address) = LOWER(?)"
    )
    .bind(&participant.wallet_address)
    .fetch_optional(tx.acquire().await?)
    .await?;

    participant.user_id = user_id.or(participant.user_id);

    // Auto-accept if user is already an accepted project member (for work allocation invites)
    if participant.allocation_id.is_some() {
        let already_accepted: bool = sqlx::query_scalar(
            "SELECT COUNT(*) > 0 FROM participants WHERE project_id = ? AND wallet_address = ? AND allocation_id IS NULL AND status = 'accepted'"
        )
        .bind(&participant.project_id)
        .bind(&participant.wallet_address)
        .fetch_one(tx.acquire().await?)
        .await
        .unwrap_or(false);

        if already_accepted {
            participant.status = "accepted".to_string();
        }
    }

    // B3-2: In custom mode, validate total shares BEFORE inserting to avoid orphan records
    if let Some(ref aid) = participant.allocation_id {
        let alloc: Option<Allocation> = sqlx::query_as("SELECT * FROM allocations WHERE id = ?")
            .bind(aid)
            .fetch_optional(tx.acquire().await?)
            .await?;
        if let Some(ref alloc) = alloc {
            if alloc.distribution_mode == "custom" {
                let current_total_shares: i64 = sqlx::query_scalar(
                    "SELECT COALESCE(SUM(shares_bps), 0) FROM participants WHERE allocation_id = ? AND status NOT IN ('rejected', 'kicked')"
                )
                .bind(aid)
                .fetch_one(tx.acquire().await?)
                .await?;
                if current_total_shares + participant.shares_bps > alloc.total_bps {
                    return Err(AppError::BadRequest(
                        format!("Total shares ({}) would exceed allocation total_bps ({})", current_total_shares + participant.shares_bps, alloc.total_bps)
                    ));
                }
            }
        }
    }

    sqlx::query(
        "INSERT INTO participants (id, project_id, user_id, wallet_address, role, shares_bps, status, allocation_id, invited_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&participant.id)
    .bind(&participant.project_id)
    .bind(&participant.user_id)
    .bind(&participant.wallet_address)
    .bind(&participant.role)
    .bind(participant.shares_bps)
    .bind(&participant.status)
    .bind(&participant.allocation_id)
    .bind(participant.invited_at)
    .execute(tx.acquire().await?)
    .await?;

    tx.commit().await?;

    // Recompute shares if allocation is in equal mode
    if let Some(ref aid) = participant.allocation_id {
        recompute_allocation_shares(&state.pool, aid).await
            .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    // Resolve invited user's name for notifications
    let invited_name: String = if let Some(ref uid) = participant.user_id {
        sqlx::query_scalar("SELECT display_name FROM users WHERE id = ?")
            .bind(uid)
            .fetch_optional(&state.pool)
            .await?
            .unwrap_or_else(|| participant.wallet_address.clone())
    } else {
        participant.wallet_address.clone()
    };

    let creator_name: String = sqlx::query_scalar("SELECT display_name FROM users WHERE id = ?")
        .bind(&claims.user_id)
        .fetch_optional(&state.pool)
        .await?
        .unwrap_or_default();

    // B2-10: Check for duplicate notifications before creating (dedup within last minute)
    // Notify the invited user
    if let Some(ref uid) = participant.user_id {
        let recent_exists: bool = sqlx::query_scalar(
            "SELECT COUNT(*) > 0 FROM notifications WHERE user_id = ? AND kind = 'invitation_received' AND reference_id = ? AND created_at > datetime('now', '-1 minute')"
        )
        .bind(uid)
        .bind(&participant.id)
        .fetch_one(&state.pool)
        .await
        .unwrap_or(false);

        if !recent_exists {
            let _ = create_notification(
                &state.pool,
                &state.notifier,
                uid,
                "invitation_received",
                &format!("{} invited you to join {}", if creator_name.is_empty() { "Someone" } else { &creator_name }, &project.name),
                "",
                Some(&participant.project_id),
                Some(&participant.id),
            ).await;
        }
    }

    // Activity entry for the creator
    {
        let recent_exists: bool = sqlx::query_scalar(
            "SELECT COUNT(*) > 0 FROM notifications WHERE user_id = ? AND kind = 'invitation_sent' AND reference_id = ? AND created_at > datetime('now', '-1 minute')"
        )
        .bind(&claims.user_id)
        .bind(&participant.id)
        .fetch_one(&state.pool)
        .await
        .unwrap_or(false);

        if !recent_exists {
            let _ = create_notification(
                &state.pool,
                &state.notifier,
                &claims.user_id,
                "invitation_sent",
                &format!("You invited {} to join {}", invited_name, &project.name),
                "",
                Some(&participant.project_id),
                Some(&participant.id),
            ).await;
        }
    }

    // Auto-accept for bot users
    if let Some(ref uid) = participant.user_id {
        let is_bot: bool = sqlx::query_scalar::<_, bool>("SELECT is_bot FROM users WHERE id = ?")
            .bind(uid)
            .fetch_optional(&state.pool)
            .await?
            .unwrap_or(false);

        if is_bot {
            let pool = state.pool.clone();
            let notifier = state.notifier.clone();
            let participant_id = participant.id.clone();
            let project_name = project.name.clone();
            let bot_user_id = uid.clone();
            let project_id_clone = participant.project_id.clone();
            let creator_id = project.creator_id.clone();
            let bot_display_name = invited_name.clone();
            let bot_delay = state.config.bot_delay_secs;
            let alloc_id = participant.allocation_id.clone();

            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(bot_delay)).await;

                let result = sqlx::query(
                    "UPDATE participants SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'invited'"
                )
                .bind(&participant_id)
                .execute(&pool)
                .await;

                match result {
                    Ok(r) if r.rows_affected() > 0 => {
                        // B4-3: Recompute shares after bot auto-accept
                        if let Some(ref aid) = alloc_id {
                            let _ = crate::routes::allocations::recompute_allocation_shares(&pool, aid).await;
                        }
                        // Notify the creator so their UI updates in real-time
                        let _ = create_notification(
                            &pool,
                            &notifier,
                            &creator_id,
                            "invitation_accepted",
                            &format!("{} joined {}", bot_display_name, project_name),
                            "",
                            Some(&project_id_clone),
                            Some(&participant_id),
                        ).await;
                        tracing::info!("Bot {} auto-accepted invitation {}", bot_user_id, participant_id);
                    }
                    Ok(_) => tracing::debug!("Bot auto-accept skipped (already handled): {}", participant_id),
                    Err(e) => tracing::error!("Bot auto-accept failed: {}", e),
                }
            });
        }
    }

    // Re-fetch to get updated shares_bps
    let updated: Participant = sqlx::query_as("SELECT * FROM participants WHERE id = ?")
        .bind(&participant.id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(updated))
}

pub async fn accept_invitation(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(participant_id): Path<String>,
) -> AppResult<Json<Participant>> {
    let participant: Participant = sqlx::query_as(
        "SELECT * FROM participants WHERE id = ?"
    )
    .bind(&participant_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Participant not found".into()))?;

    if participant.wallet_address.to_lowercase() != claims.sub.to_lowercase() {
        return Err(AppError::Forbidden("Not your invitation".into()));
    }

    if participant.status != "invited" {
        return Err(AppError::BadRequest("Invitation is not in a pending state".into()));
    }

    sqlx::query(
        "UPDATE participants SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP WHERE id = ?"
    )
    .bind(&participant_id)
    .execute(&state.pool)
    .await?;

    // B4-2: Recompute shares after acceptance (equal mode needs updated participant count)
    if let Some(ref aid) = participant.allocation_id {
        recompute_allocation_shares(&state.pool, aid).await
            .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    let updated: Participant = sqlx::query_as("SELECT * FROM participants WHERE id = ?")
        .bind(&participant_id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(updated))
}

pub async fn reject_invitation(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(participant_id): Path<String>,
) -> AppResult<Json<Participant>> {
    let participant: Participant = sqlx::query_as(
        "SELECT * FROM participants WHERE id = ?"
    )
    .bind(&participant_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Participant not found".into()))?;

    if participant.wallet_address.to_lowercase() != claims.sub.to_lowercase() {
        return Err(AppError::Forbidden("Not your invitation".into()));
    }

    if participant.status != "invited" {
        return Err(AppError::BadRequest("Invitation is not in a pending state".into()));
    }

    sqlx::query("UPDATE participants SET status = 'rejected' WHERE id = ?")
        .bind(&participant_id)
        .execute(&state.pool)
        .await?;

    // Recompute shares for the allocation
    if let Some(ref aid) = participant.allocation_id {
        recompute_allocation_shares(&state.pool, aid).await
            .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    let updated: Participant = sqlx::query_as("SELECT * FROM participants WHERE id = ?")
        .bind(&participant_id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(updated))
}

/// Creator kicks a participant
pub async fn kick_participant(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(participant_id): Path<String>,
) -> AppResult<Json<Participant>> {
    let participant: Participant = sqlx::query_as(
        "SELECT * FROM participants WHERE id = ?"
    )
    .bind(&participant_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Participant not found".into()))?;

    let project: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
        .bind(&participant.project_id)
        .fetch_one(&state.pool)
        .await?;

    if project.creator_id != claims.user_id {
        return Err(AppError::Forbidden("Not project creator".into()));
    }

    if participant.status == "kicked" || participant.status == "rejected" {
        return Err(AppError::BadRequest("Participant already removed".into()));
    }

    sqlx::query("UPDATE participants SET status = 'kicked' WHERE id = ?")
        .bind(&participant_id)
        .execute(&state.pool)
        .await?;

    // Recompute shares for the allocation
    if let Some(ref aid) = participant.allocation_id {
        recompute_allocation_shares(&state.pool, aid).await
            .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    // Notify the kicked participant
    if let Some(ref uid) = participant.user_id {
        let _ = create_notification(
            &state.pool,
            &state.notifier,
            uid,
            "participant_kicked",
            &format!("You were removed from {}", &project.name),
            "",
            Some(&participant.project_id),
            Some(&participant_id),
        ).await;
    }

    let updated: Participant = sqlx::query_as("SELECT * FROM participants WHERE id = ?")
        .bind(&participant_id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(updated))
}

pub async fn update_participant(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(participant_id): Path<String>,
    Json(body): Json<UpdateParticipant>,
) -> AppResult<Json<Participant>> {
    let participant: Participant = sqlx::query_as(
        "SELECT * FROM participants WHERE id = ?"
    )
    .bind(&participant_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Participant not found".into()))?;

    let project: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
        .bind(&participant.project_id)
        .fetch_one(&state.pool)
        .await?;

    if project.creator_id != claims.user_id {
        return Err(AppError::Forbidden("Not project creator".into()));
    }

    if let Some(ref role) = body.role {
        sqlx::query("UPDATE participants SET role = ? WHERE id = ?")
            .bind(role).bind(&participant_id).execute(&state.pool).await?;
    }
    if let Some(shares) = body.shares_bps {
        if shares < 0 {
            return Err(AppError::BadRequest("shares_bps cannot be negative".into()));
        }
        // B3-3: Upper bound check
        if shares > 10000 {
            return Err(AppError::BadRequest("shares_bps cannot exceed 10000".into()));
        }
        // B3-3: Validate that new shares + other participants' shares don't exceed allocation total_bps
        if let Some(ref alloc_id) = participant.allocation_id {
            let alloc: Option<Allocation> = sqlx::query_as("SELECT * FROM allocations WHERE id = ?")
                .bind(alloc_id)
                .fetch_optional(&state.pool)
                .await?;
            if let Some(alloc) = alloc {
                let others_total: i64 = sqlx::query_scalar(
                    "SELECT COALESCE(SUM(shares_bps), 0) FROM participants WHERE allocation_id = ? AND id != ? AND status NOT IN ('rejected', 'kicked')"
                )
                .bind(alloc_id)
                .bind(&participant_id)
                .fetch_one(&state.pool)
                .await?;
                if others_total + shares > alloc.total_bps {
                    return Err(AppError::BadRequest(
                        format!("Total shares ({}) would exceed allocation total_bps ({})", others_total + shares, alloc.total_bps)
                    ));
                }
            }
        }
        sqlx::query("UPDATE participants SET shares_bps = ? WHERE id = ?")
            .bind(shares).bind(&participant_id).execute(&state.pool).await?;
    }

    let updated: Participant = sqlx::query_as("SELECT * FROM participants WHERE id = ?")
        .bind(&participant_id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(updated))
}
