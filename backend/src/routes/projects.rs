use axum::{extract::{State, Path}, Extension, Json};
use serde::Serialize;
use sqlx::Acquire;

use crate::error::{AppError, AppResult};
use crate::middleware::Claims;
use crate::models::{Project, CreateProject, UpdateProject, Participant, Allocation};
use crate::routes::allocations::AllocationDetail;
use crate::services::notifications::create_notification;
use crate::AppState;

#[derive(Serialize)]
pub struct ProjectDetail {
    #[serde(flatten)]
    pub project: Project,
    pub participants: Vec<Participant>,
    pub allocations: Vec<AllocationDetail>,
    pub creator_shares_bps: i64,
}

pub async fn create_project(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Json(body): Json<CreateProject>,
) -> AppResult<Json<Project>> {
    if body.name.len() > 200 {
        return Err(AppError::BadRequest("Project name too long (max 200 chars)".into()));
    }
    if body.description.len() > 5000 {
        return Err(AppError::BadRequest("Description too long (max 5000 chars)".into()));
    }
    if body.royalty_bps < 0 || body.royalty_bps > 10000 {
        return Err(AppError::BadRequest("royalty_bps must be between 0 and 10000".into()));
    }
    let project = Project::new(claims.user_id, body);

    sqlx::query(
        "INSERT INTO projects (id, name, description, status, creator_id, royalty_bps, logo_url, max_participants, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&project.id)
    .bind(&project.name)
    .bind(&project.description)
    .bind(&project.status)
    .bind(&project.creator_id)
    .bind(project.royalty_bps)
    .bind(&project.logo_url)
    .bind(project.max_participants)
    .bind(project.created_at)
    .execute(&state.pool)
    .await?;

    Ok(Json(project))
}

pub async fn list_my_projects(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
) -> AppResult<Json<Vec<Project>>> {
    let projects: Vec<Project> = sqlx::query_as(
        "SELECT DISTINCT p.* FROM projects p
         LEFT JOIN participants pt ON pt.project_id = p.id
         WHERE p.creator_id = ? OR pt.wallet_address = ?
         ORDER BY p.created_at DESC
         LIMIT 200"
    )
    .bind(&claims.user_id)
    .bind(&claims.sub)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(projects))
}

pub async fn get_project(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<ProjectDetail>> {
    let project: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".into()))?;

    if !super::is_project_member(&state.pool, &id, &claims.user_id).await {
        return Err(AppError::Forbidden("Not a member of this project".into()));
    }

    let participants: Vec<Participant> = sqlx::query_as(
        "SELECT * FROM participants WHERE project_id = ? LIMIT 500"
    )
    .bind(&id)
    .fetch_all(&state.pool)
    .await?;

    // Build allocation details
    let allocations_raw: Vec<Allocation> = sqlx::query_as(
        "SELECT * FROM allocations WHERE project_id = ? ORDER BY sort_order, created_at LIMIT 200"
    )
    .bind(&id)
    .fetch_all(&state.pool)
    .await?;

    // Fetch all participants for all allocations in one query
    let all_alloc_participants: Vec<Participant> = sqlx::query_as(
        "SELECT p.* FROM participants p
         INNER JOIN allocations a ON p.allocation_id = a.id
         WHERE a.project_id = ? LIMIT 500"
    )
    .bind(&id)
    .fetch_all(&state.pool)
    .await?;

    let mut allocations = Vec::new();
    for alloc in allocations_raw {
        let alloc_participants: Vec<Participant> = all_alloc_participants
            .iter()
            .filter(|p| p.allocation_id.as_deref() == Some(&alloc.id))
            .cloned()
            .collect();

        let filled = alloc_participants.len() as i64;
        let open = alloc.max_slots.map(|max| (max - filled).max(0));

        allocations.push(AllocationDetail {
            allocation: alloc,
            participants: alloc_participants,
            filled_slots: filled,
            open_slots: open,
        });
    }

    let alloc_total: i64 = allocations.iter().map(|a| a.allocation.total_bps).sum();
    let creator_shares_bps = (10000 - alloc_total).max(0);

    Ok(Json(ProjectDetail { project, participants, allocations, creator_shares_bps }))
}

pub async fn update_project(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateProject>,
) -> AppResult<Json<Project>> {
    let project: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".into()))?;

    if project.creator_id != claims.user_id {
        return Err(AppError::Forbidden("Not project creator".into()));
    }

    if !["draft", "active"].contains(&project.status.as_str()) {
        return Err(AppError::BadRequest("Cannot edit project in this status".into()));
    }

    if let Some(ref name) = body.name {
        if name.len() > 200 {
            return Err(AppError::BadRequest("Project name too long (max 200 chars)".into()));
        }
        sqlx::query("UPDATE projects SET name = ? WHERE id = ?")
            .bind(name).bind(&id).execute(&state.pool).await?;
    }
    if let Some(ref desc) = body.description {
        if desc.len() > 5000 {
            return Err(AppError::BadRequest("Description too long (max 5000 chars)".into()));
        }
        sqlx::query("UPDATE projects SET description = ? WHERE id = ?")
            .bind(desc).bind(&id).execute(&state.pool).await?;
    }
    if let Some(bps) = body.royalty_bps {
        if bps < 0 || bps > 10000 {
            return Err(AppError::BadRequest("royalty_bps must be between 0 and 10000".into()));
        }
        sqlx::query("UPDATE projects SET royalty_bps = ? WHERE id = ?")
            .bind(bps).bind(&id).execute(&state.pool).await?;
    }
    if let Some(ref logo) = body.logo_url {
        if logo.len() > 500_000 {
            return Err(AppError::BadRequest("Logo URL too long".into()));
        }
        sqlx::query("UPDATE projects SET logo_url = ? WHERE id = ?")
            .bind(logo).bind(&id).execute(&state.pool).await?;
    }

    let updated: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
        .bind(&id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(updated))
}

/// Creator closes a project: active → closed
pub async fn close_project(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<Project>> {
    let project: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".into()))?;

    if project.creator_id != claims.user_id {
        return Err(AppError::Forbidden("Not project creator".into()));
    }

    if project.status == "closed" {
        return Err(AppError::BadRequest("Project is already closed".into()));
    }

    sqlx::query("UPDATE projects SET status = 'closed' WHERE id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await?;

    let updated: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
        .bind(&id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(updated))
}

/// Creator reopens a closed project: closed → active
pub async fn reopen_project(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<Project>> {
    let project: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".into()))?;

    if project.creator_id != claims.user_id {
        return Err(AppError::Forbidden("Not project creator".into()));
    }

    if project.status != "closed" {
        return Err(AppError::BadRequest("Project is not closed".into()));
    }

    sqlx::query("UPDATE projects SET status = 'active' WHERE id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await?;

    let updated: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
        .bind(&id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(updated))
}

/// Creator submits project for participant approval: draft → pending_approval
pub async fn submit_for_approval(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<Project>> {
    let project: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".into()))?;

    if project.creator_id != claims.user_id {
        return Err(AppError::Forbidden("Not project creator".into()));
    }
    if project.status != "draft" && project.status != "active" {
        return Err(AppError::BadRequest("Project must be in active or draft status".into()));
    }

    // Wrap approval workflow in a transaction to prevent race conditions
    let mut tx = state.pool.begin().await?;

    // Check accepted participants
    let accepted: Vec<Participant> = sqlx::query_as(
        "SELECT * FROM participants WHERE project_id = ? AND status = 'accepted'"
    )
    .bind(&id)
    .fetch_all(tx.acquire().await?)
    .await?;

    if accepted.is_empty() {
        // Solo mode: no participants, creator is alone → skip directly to approved
        sqlx::query("UPDATE projects SET status = 'approved' WHERE id = ?")
            .bind(&id)
            .execute(tx.acquire().await?)
            .await?;
    } else {
        // Collab mode: require allocations and go through pending_approval flow
        let alloc_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM allocations WHERE project_id = ?")
            .bind(&id)
            .fetch_one(tx.acquire().await?)
            .await?;

        if alloc_count == 0 {
            tx.rollback().await?;
            return Err(AppError::BadRequest("No allocations defined".into()));
        }

        // Reset approved_at for all accepted participants
        sqlx::query("UPDATE participants SET approved_at = NULL WHERE project_id = ? AND status = 'accepted'")
            .bind(&id)
            .execute(tx.acquire().await?)
            .await?;

        // Update project status
        sqlx::query("UPDATE projects SET status = 'pending_approval' WHERE id = ?")
            .bind(&id)
            .execute(tx.acquire().await?)
            .await?;

    }

    tx.commit().await?;

    // Notify each accepted participant (outside transaction - non-critical)
    if !accepted.is_empty() {
        for pt in &accepted {
            if let Some(ref uid) = pt.user_id {
                let _ = create_notification(
                    &state.pool,
                    &state.notifier,
                    uid,
                    "approval_requested",
                    "Approval required",
                    &format!("The creator of \"{}\" is asking you to approve the contract terms.", project.name),
                    Some(&id),
                    None,
                ).await;
            }
        }
    }

    let updated: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
        .bind(&id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(updated))
}

/// Accepted participant approves the contract terms
pub async fn approve_terms(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<Project>> {
    let project: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".into()))?;

    if project.status != "pending_approval" {
        return Err(AppError::BadRequest("Project is not pending approval".into()));
    }

    // Find participant for current user
    let participant: Participant = sqlx::query_as(
        "SELECT * FROM participants WHERE project_id = ? AND user_id = ? AND status = 'accepted'"
    )
    .bind(&id)
    .bind(&claims.user_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::Forbidden("You are not an accepted participant of this project".into()))?;

    if participant.approved_at.is_some() {
        return Err(AppError::BadRequest("You have already approved".into()));
    }

    // Set approved_at
    sqlx::query("UPDATE participants SET approved_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(&participant.id)
        .execute(&state.pool)
        .await?;

    // Notify creator
    let _ = create_notification(
        &state.pool,
        &state.notifier,
        &project.creator_id,
        "participant_approved",
        "A collaborator approved",
        &format!("A collaborator approved the terms for \"{}\".", project.name),
        Some(&id),
        None,
    ).await;

    // Atomically transition to approved only if all accepted participants have approved
    let result = sqlx::query(
        "UPDATE projects SET status = 'approved' WHERE id = ? AND status = 'pending_approval'
         AND NOT EXISTS (
             SELECT 1 FROM participants WHERE project_id = ? AND status = 'accepted' AND approved_at IS NULL
         )"
    )
    .bind(&id)
    .bind(&id)
    .execute(&state.pool)
    .await?;

    if result.rows_affected() > 0 {
        let _ = create_notification(
            &state.pool,
            &state.notifier,
            &project.creator_id,
            "all_approved",
            "All collaborators approved",
            &format!("All collaborators approved \"{}\". You can finalize.", project.name),
            Some(&id),
            None,
        ).await;
    }

    let updated: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
        .bind(&id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(updated))
}
