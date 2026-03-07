use axum::{extract::{State, Path, Query}, Extension, Json};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::middleware::Claims;
use crate::models::Notification;
use crate::AppState;

#[derive(Deserialize)]
pub struct NotificationQuery {
    pub unread: Option<bool>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct UnreadCount {
    pub count: i64,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct ActivityItem {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub reference_id: Option<String>,
    pub is_read: bool,
    pub created_at: String,
}

pub async fn list_notifications(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Query(params): Query<NotificationQuery>,
) -> AppResult<Json<Vec<Notification>>> {
    let notifications = if params.unread == Some(true) {
        sqlx::query_as::<_, Notification>(
            "SELECT * FROM notifications WHERE user_id = ? AND is_read = 0 ORDER BY created_at DESC LIMIT 100"
        )
        .bind(&claims.user_id)
        .fetch_all(&state.pool)
        .await?
    } else {
        sqlx::query_as::<_, Notification>(
            "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100"
        )
        .bind(&claims.user_id)
        .fetch_all(&state.pool)
        .await?
    };

    Ok(Json(notifications))
}

pub async fn unread_count(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
) -> AppResult<Json<UnreadCount>> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = 0"
    )
    .bind(&claims.user_id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(UnreadCount { count }))
}

pub async fn mark_read(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<Notification>> {
    let notif: Notification = sqlx::query_as(
        "SELECT * FROM notifications WHERE id = ? AND user_id = ?"
    )
    .bind(&id)
    .bind(&claims.user_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Notification not found".into()))?;

    sqlx::query("UPDATE notifications SET is_read = 1 WHERE id = ?")
        .bind(&notif.id)
        .execute(&state.pool)
        .await?;

    let updated: Notification = sqlx::query_as("SELECT * FROM notifications WHERE id = ?")
        .bind(&id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(updated))
}

pub async fn mark_all_read(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
) -> AppResult<Json<serde_json::Value>> {
    sqlx::query("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0")
        .bind(&claims.user_id)
        .execute(&state.pool)
        .await?;

    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn get_project_activity(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> AppResult<Json<Vec<ActivityItem>>> {
    // Verify project exists and user is a member
    let creator_id: Option<String> = sqlx::query_scalar(
        "SELECT creator_id FROM projects WHERE id = ?"
    )
    .bind(&project_id)
    .fetch_optional(&state.pool)
    .await?;

    let creator_id = creator_id.ok_or_else(|| AppError::NotFound("Project not found".into()))?;

    let is_member = if creator_id == claims.user_id {
        true
    } else {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM participants WHERE project_id = ? AND (user_id = ? OR wallet_address = ?) AND status IN ('accepted', 'invited')"
        )
        .bind(&project_id)
        .bind(&claims.user_id)
        .bind(&claims.sub)
        .fetch_one(&state.pool)
        .await?;
        count > 0
    };

    if !is_member {
        return Err(AppError::Forbidden("Only project members can view activity".into()));
    }

    // Show only notifications addressed to the current user for this project
    let notifications: Vec<Notification> = sqlx::query_as(
        "SELECT * FROM notifications WHERE project_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 100"
    )
    .bind(&project_id)
    .bind(&claims.user_id)
    .fetch_all(&state.pool)
    .await?;

    let items: Vec<ActivityItem> = notifications.into_iter().map(|n| ActivityItem {
        id: n.id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        reference_id: n.reference_id,
        is_read: n.is_read,
        created_at: n.created_at.to_string(),
    }).collect();

    Ok(Json(items))
}
