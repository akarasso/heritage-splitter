use axum::{extract::{State, Path}, Extension, Json};
use serde::Serialize;
use sqlx::{Acquire, SqlitePool};

use crate::error::{AppError, AppResult};
use crate::middleware::Claims;
use crate::models::{Allocation, CreateAllocation, UpdateAllocation, Participant, Project, Collection};
use crate::AppState;

#[derive(Serialize, utoipa::ToSchema)]
pub struct AllocationDetail {
    #[serde(flatten)]
    pub allocation: Allocation,
    pub participants: Vec<Participant>,
    pub filled_slots: i64,
    pub open_slots: Option<i64>,
}

pub async fn create_allocation(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(body): Json<CreateAllocation>,
) -> AppResult<Json<Allocation>> {
    let project: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
        .bind(&project_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".into()))?;

    if project.creator_id != claims.user_id {
        return Err(AppError::Forbidden("Not project creator".into()));
    }
    if project.status != "draft" {
        return Err(AppError::BadRequest("Can only edit drafts".into()));
    }

    // Validate text fields
    if body.role.len() > 100 {
        return Err(AppError::BadRequest("Role too long (max 100 chars)".into()));
    }
    if body.label.len() > 200 {
        return Err(AppError::BadRequest("Label too long (max 200 chars)".into()));
    }

    // Validate max_slots if provided
    // B3-7: Add reasonable upper bound to prevent absurdly large values
    if let Some(max) = body.max_slots {
        if max <= 0 {
            return Err(AppError::BadRequest("max_slots must be greater than 0".into()));
        }
        if max > 1000 {
            return Err(AppError::BadRequest("max_slots cannot exceed 1000".into()));
        }
    }

    // Validate total_bps
    if body.total_bps <= 0 || body.total_bps > 10000 {
        return Err(AppError::BadRequest("total_bps must be between 1 and 10000".into()));
    }

    // B2-5: Validate distribution_mode on create
    // B3-6: Confirmed false positive — an empty string "" fails this check since it is
    // neither "equal" nor "custom", so it is correctly rejected.
    if body.distribution_mode != "equal" && body.distribution_mode != "custom" {
        return Err(AppError::BadRequest("distribution_mode must be 'equal' or 'custom'".into()));
    }

    // Check sum of existing project-level allocations (collection_id IS NULL) + new one doesn't exceed 10000
    let existing_sum: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_bps), 0) FROM allocations WHERE project_id = ? AND collection_id IS NULL"
    )
    .bind(&project_id)
    .fetch_one(&state.pool)
    .await?;

    if existing_sum + body.total_bps > 10000 {
        return Err(AppError::BadRequest(
            format!("Total allocations would be {} bps (max 10000)", existing_sum + body.total_bps)
        ));
    }

    let allocation = Allocation::new(project_id, body);

    sqlx::query(
        "INSERT INTO allocations (id, project_id, role, label, total_bps, max_slots, distribution_mode, sort_order, receives_primary, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
    .bind(allocation.created_at)
    .execute(&state.pool)
    .await?;

    Ok(Json(allocation))
}

pub async fn list_allocations(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> AppResult<Json<Vec<AllocationDetail>>> {
    if !super::is_project_member(&state.pool, &project_id, &claims.user_id).await {
        return Err(AppError::Forbidden("Not a member of this project".into()));
    }
    let allocations: Vec<Allocation> = sqlx::query_as(
        "SELECT * FROM allocations WHERE project_id = ? ORDER BY sort_order, created_at LIMIT 100"
    )
    .bind(&project_id)
    .fetch_all(&state.pool)
    .await?;

    let mut result = Vec::new();
    for alloc in allocations {
        let participants: Vec<Participant> = sqlx::query_as(
            "SELECT * FROM participants WHERE allocation_id = ? LIMIT 500"
        )
        .bind(&alloc.id)
        .fetch_all(&state.pool)
        .await?;

        let filled = participants.len() as i64;
        let open = alloc.max_slots.map(|max| (max - filled).max(0));

        result.push(AllocationDetail {
            allocation: alloc,
            participants,
            filled_slots: filled,
            open_slots: open,
        });
    }

    Ok(Json(result))
}

pub async fn update_allocation(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(allocation_id): Path<String>,
    Json(body): Json<UpdateAllocation>,
) -> AppResult<Json<Allocation>> {
    let alloc: Allocation = sqlx::query_as("SELECT * FROM allocations WHERE id = ?")
        .bind(&allocation_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Allocation not found".into()))?;

    let project: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
        .bind(&alloc.project_id)
        .fetch_one(&state.pool)
        .await?;

    if project.creator_id != claims.user_id {
        return Err(AppError::Forbidden("Not project creator".into()));
    }

    // If allocation belongs to a collection, check collection status; otherwise check project status
    if let Some(ref wid) = alloc.collection_id {
        let collection: Collection = sqlx::query_as("SELECT * FROM collections WHERE id = ?")
            .bind(wid)
            .fetch_one(&state.pool)
            .await?;
        if ["pending_approval", "approved"].contains(&collection.status.as_str()) {
            // Auto-reset to draft
            sqlx::query("UPDATE collections SET status = 'draft' WHERE id = ?")
                .bind(wid).execute(&state.pool).await?;
            // B2-6: Only reset approvals for participants of THIS allocation, not all allocations of the collection
            sqlx::query(
                "UPDATE participants SET approved_at = NULL
                 WHERE allocation_id = ? AND status NOT IN ('rejected', 'kicked')"
            ).bind(&allocation_id).execute(&state.pool).await?;
        } else if collection.status != "draft" {
            return Err(AppError::BadRequest("Can only edit draft collections".into()));
        }
    } else if project.status != "draft" {
        return Err(AppError::BadRequest("Can only edit drafts".into()));
    }

    // Validate total_bps if changing
    if let Some(new_bps) = body.total_bps {
        if new_bps <= 0 || new_bps > 10000 {
            return Err(AppError::BadRequest("total_bps must be between 1 and 10000".into()));
        }
        let other_sum: i64 = if let Some(ref wid) = alloc.collection_id {
            sqlx::query_scalar(
                "SELECT COALESCE(SUM(total_bps), 0) FROM allocations WHERE collection_id = ? AND id != ?"
            )
            .bind(wid)
            .bind(&allocation_id)
            .fetch_one(&state.pool)
            .await?
        } else {
            sqlx::query_scalar(
                "SELECT COALESCE(SUM(total_bps), 0) FROM allocations WHERE project_id = ? AND id != ? AND collection_id IS NULL"
            )
            .bind(&alloc.project_id)
            .bind(&allocation_id)
            .fetch_one(&state.pool)
            .await?
        };

        if other_sum + new_bps > 10000 {
            return Err(AppError::BadRequest(
                format!("Total allocations would be {} bps (max 10000)", other_sum + new_bps)
            ));
        }

        sqlx::query("UPDATE allocations SET total_bps = ? WHERE id = ?")
            .bind(new_bps).bind(&allocation_id).execute(&state.pool).await?;

        // Recompute participant shares if in equal mode
        recompute_equal_shares(&state.pool, &allocation_id, new_bps).await?;
    }

    if let Some(ref role) = body.role {
        if role.len() > 100 {
            return Err(AppError::BadRequest("Role too long (max 100 chars)".into()));
        }
        sqlx::query("UPDATE allocations SET role = ? WHERE id = ?")
            .bind(role).bind(&allocation_id).execute(&state.pool).await?;
    }
    if let Some(ref label) = body.label {
        if label.len() > 200 {
            return Err(AppError::BadRequest("Label too long (max 200 chars)".into()));
        }
        sqlx::query("UPDATE allocations SET label = ? WHERE id = ?")
            .bind(label).bind(&allocation_id).execute(&state.pool).await?;
    }
    if let Some(ref max_slots) = body.max_slots {
        if let Some(val) = max_slots {
            if *val <= 0 {
                return Err(AppError::BadRequest("max_slots must be greater than 0".into()));
            }
            // B3-7: Reasonable upper bound
            if *val > 1000 {
                return Err(AppError::BadRequest("max_slots cannot exceed 1000".into()));
            }
        }
        sqlx::query("UPDATE allocations SET max_slots = ? WHERE id = ?")
            .bind(max_slots).bind(&allocation_id).execute(&state.pool).await?;
    }
    if let Some(ref mode) = body.distribution_mode {
        // B2-5: Validate distribution_mode
        // B3-6: Confirmed false positive — empty string "" is neither "equal" nor "custom", so correctly rejected.
        if mode != "equal" && mode != "custom" {
            return Err(AppError::BadRequest("distribution_mode must be 'equal' or 'custom'".into()));
        }
        sqlx::query("UPDATE allocations SET distribution_mode = ? WHERE id = ?")
            .bind(mode).bind(&allocation_id).execute(&state.pool).await?;
    }
    if let Some(order) = body.sort_order {
        sqlx::query("UPDATE allocations SET sort_order = ? WHERE id = ?")
            .bind(order).bind(&allocation_id).execute(&state.pool).await?;
    }
    if let Some(receives_primary) = body.receives_primary {
        sqlx::query("UPDATE allocations SET receives_primary = ? WHERE id = ?")
            .bind(receives_primary).bind(&allocation_id).execute(&state.pool).await?;
    }

    let updated: Allocation = sqlx::query_as("SELECT * FROM allocations WHERE id = ?")
        .bind(&allocation_id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(updated))
}

pub async fn delete_allocation(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(allocation_id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    let alloc: Allocation = sqlx::query_as("SELECT * FROM allocations WHERE id = ?")
        .bind(&allocation_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Allocation not found".into()))?;

    let project: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
        .bind(&alloc.project_id)
        .fetch_one(&state.pool)
        .await?;

    if project.creator_id != claims.user_id {
        return Err(AppError::Forbidden("Not project creator".into()));
    }

    // If allocation belongs to a collection, check collection status; otherwise check project status
    if let Some(ref wid) = alloc.collection_id {
        let collection: Collection = sqlx::query_as("SELECT * FROM collections WHERE id = ?")
            .bind(wid)
            .fetch_one(&state.pool)
            .await?;
        if ["pending_approval", "approved"].contains(&collection.status.as_str()) {
            // Auto-reset to draft
            sqlx::query("UPDATE collections SET status = 'draft' WHERE id = ?")
                .bind(wid).execute(&state.pool).await?;
            sqlx::query(
                "UPDATE participants SET approved_at = NULL
                 WHERE allocation_id IN (SELECT id FROM allocations WHERE collection_id = ?) AND status NOT IN ('rejected', 'kicked')"
            ).bind(wid).execute(&state.pool).await?;
        } else if collection.status != "draft" {
            return Err(AppError::BadRequest("Can only edit draft collections".into()));
        }
    } else if project.status != "draft" {
        return Err(AppError::BadRequest("Can only edit drafts".into()));
    }

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM participants WHERE allocation_id = ?"
    )
    .bind(&allocation_id)
    .fetch_one(&state.pool)
    .await?;

    if count > 0 {
        return Err(AppError::BadRequest(
            format!("Cannot delete allocation with {} participants", count)
        ));
    }

    sqlx::query("DELETE FROM allocations WHERE id = ?")
        .bind(&allocation_id)
        .execute(&state.pool)
        .await?;

    Ok(Json(serde_json::json!({ "deleted": true })))
}

pub async fn recompute_shares(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(allocation_id): Path<String>,
) -> AppResult<Json<Vec<Participant>>> {
    let alloc: Allocation = sqlx::query_as("SELECT * FROM allocations WHERE id = ?")
        .bind(&allocation_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Allocation not found".into()))?;

    let project: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
        .bind(&alloc.project_id)
        .fetch_one(&state.pool)
        .await?;

    if project.creator_id != claims.user_id {
        return Err(AppError::Forbidden("Not project creator".into()));
    }

    if alloc.distribution_mode != "equal" {
        return Err(AppError::BadRequest("Only equal mode supports auto-recompute".into()));
    }

    recompute_equal_shares(&state.pool, &allocation_id, alloc.total_bps).await?;

    let participants: Vec<Participant> = sqlx::query_as(
        "SELECT * FROM participants WHERE allocation_id = ? LIMIT 500"
    )
    .bind(&allocation_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(participants))
}

/// Recompute equal shares for all active participants in an allocation (wrapped in transaction)
async fn recompute_equal_shares(
    pool: &SqlitePool,
    allocation_id: &str,
    total_bps: i64,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;

    let alloc: Option<Allocation> = sqlx::query_as("SELECT * FROM allocations WHERE id = ?")
        .bind(allocation_id)
        .fetch_optional(tx.acquire().await?)
        .await?;

    let alloc = match alloc {
        Some(a) => a,
        None => return Ok(()),
    };

    if alloc.distribution_mode != "equal" {
        return Ok(());
    }

    // B3-5: Only count accepted participants for share computation.
    // Invited participants should not receive shares until they accept.
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM participants WHERE allocation_id = ? AND status = 'accepted'"
    )
    .bind(allocation_id)
    .fetch_one(tx.acquire().await?)
    .await?;

    // Zero out shares for non-accepted participants (invited, rejected, kicked)
    sqlx::query(
        "UPDATE participants SET shares_bps = 0 WHERE allocation_id = ? AND status != 'accepted'"
    )
    .bind(allocation_id)
    .execute(tx.acquire().await?)
    .await?;

    if count > 0 {
        let per_participant = total_bps / count;
        let remainder = total_bps - per_participant * count;

        // Set base share for accepted participants only
        sqlx::query(
            "UPDATE participants SET shares_bps = ? WHERE allocation_id = ? AND status = 'accepted'"
        )
        .bind(per_participant)
        .bind(allocation_id)
        .execute(tx.acquire().await?)
        .await?;

        // Distribute remainder to first accepted participants (1 extra bps each)
        if remainder > 0 {
            let first_ids: Vec<(String,)> = sqlx::query_as(
                "SELECT id FROM participants WHERE allocation_id = ? AND status = 'accepted' ORDER BY invited_at LIMIT ?"
            )
            .bind(allocation_id)
            .bind(remainder)
            .fetch_all(tx.acquire().await?)
            .await?;

            for (pid,) in first_ids {
                sqlx::query("UPDATE participants SET shares_bps = ? WHERE id = ?")
                    .bind(per_participant + 1)
                    .bind(&pid)
                    .execute(tx.acquire().await?)
                    .await?;
            }
        }
    }

    tx.commit().await?;
    Ok(())
}

/// Public helper used by participant routes to recompute after adding/removing
pub async fn recompute_allocation_shares(pool: &SqlitePool, allocation_id: &str) -> Result<(), sqlx::Error> {
    let alloc: Option<Allocation> = sqlx::query_as("SELECT * FROM allocations WHERE id = ?")
        .bind(allocation_id)
        .fetch_optional(pool)
        .await?;

    if let Some(alloc) = alloc {
        if alloc.distribution_mode == "equal" {
            recompute_equal_shares(pool, allocation_id, alloc.total_bps).await?;
        }
    }

    Ok(())
}
