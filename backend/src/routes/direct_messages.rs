use axum::{extract::{State, Path, Query}, Extension, Json};
use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::middleware::Claims;
use crate::models::{DirectMessageDetail, CreateDirectMessage};
use crate::services::notifications::create_notification;
use crate::AppState;

#[derive(Deserialize)]
pub struct DmPaginationQuery {
    pub before: Option<String>,  // ISO timestamp cursor
    pub limit: Option<i64>,      // default 50, max 100
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct PaginatedMessages {
    pub messages: Vec<DirectMessageDetail>,
    pub has_more: bool,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct Conversation {
    pub user_id: String,
    pub display_name: String,
    pub avatar_url: String,
    pub last_message: String,
    pub last_message_at: String,
    pub unread_count: i64,
}

pub async fn list_conversations(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
) -> AppResult<Json<Vec<Conversation>>> {
    // Get all distinct conversation partners
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT DISTINCT
            CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END as partner_id,
            u.display_name,
            u.avatar_url
         FROM direct_messages dm
         JOIN users u ON u.id = CASE WHEN dm.sender_id = ? THEN dm.recipient_id ELSE dm.sender_id END
         WHERE dm.sender_id = ? OR dm.recipient_id = ?
         ORDER BY dm.created_at DESC
         LIMIT 100"
    )
    .bind(&claims.user_id)
    .bind(&claims.user_id)
    .bind(&claims.user_id)
    .bind(&claims.user_id)
    .fetch_all(&state.pool)
    .await?;

    let mut conversations = Vec::new();
    for (partner_id, display_name, avatar_url) in rows {
        // Get last message
        let last: Option<(String, String)> = sqlx::query_as(
            "SELECT content, created_at FROM direct_messages
             WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
             ORDER BY created_at DESC LIMIT 1"
        )
        .bind(&claims.user_id)
        .bind(&partner_id)
        .bind(&partner_id)
        .bind(&claims.user_id)
        .fetch_optional(&state.pool)
        .await?;

        let (last_message, last_message_at) = last.unwrap_or_default();

        // Count unread
        let unread_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM direct_messages WHERE sender_id = ? AND recipient_id = ? AND is_read = 0"
        )
        .bind(&partner_id)
        .bind(&claims.user_id)
        .fetch_one(&state.pool)
        .await?;

        conversations.push(Conversation {
            user_id: partner_id,
            display_name,
            avatar_url,
            last_message,
            last_message_at,
            unread_count,
        });
    }

    Ok(Json(conversations))
}

pub async fn get_conversation(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(user_id): Path<String>,
    Query(query): Query<DmPaginationQuery>,
) -> AppResult<Json<PaginatedMessages>> {
    let limit = query.limit.unwrap_or(50).min(100).max(1);

    // Only mark as read on initial load (no cursor)
    if query.before.is_none() {
        sqlx::query("UPDATE direct_messages SET is_read = 1 WHERE sender_id = ? AND recipient_id = ?")
            .bind(&user_id)
            .bind(&claims.user_id)
            .execute(&state.pool)
            .await?;
    }

    // Fetch limit + 1 to determine has_more
    let fetch_limit = limit + 1;

    // B2-4: Validate cursor format before using in SQL
    if let Some(ref before) = query.before {
        if NaiveDateTime::parse_from_str(before, "%Y-%m-%d %H:%M:%S").is_err()
            && NaiveDateTime::parse_from_str(before, "%Y-%m-%dT%H:%M:%S").is_err()
            && NaiveDateTime::parse_from_str(before, "%Y-%m-%dT%H:%M:%S%.f").is_err()
            && NaiveDateTime::parse_from_str(before, "%Y-%m-%d %H:%M:%S%.f").is_err()
        {
            return Err(AppError::BadRequest("Invalid 'before' cursor format".into()));
        }
    }

    let mut messages: Vec<DirectMessageDetail> = if let Some(ref before) = query.before {
        sqlx::query_as(
            "SELECT dm.id, dm.sender_id, dm.recipient_id, dm.content, dm.is_read, dm.created_at,
                    u.display_name as sender_name, u.avatar_url as sender_avatar
             FROM direct_messages dm
             JOIN users u ON u.id = dm.sender_id
             WHERE ((dm.sender_id = ? AND dm.recipient_id = ?) OR (dm.sender_id = ? AND dm.recipient_id = ?))
               AND dm.created_at < ?
             ORDER BY dm.created_at DESC
             LIMIT ?"
        )
        .bind(&claims.user_id)
        .bind(&user_id)
        .bind(&user_id)
        .bind(&claims.user_id)
        .bind(before)
        .bind(fetch_limit)
        .fetch_all(&state.pool)
        .await?
    } else {
        sqlx::query_as(
            "SELECT dm.id, dm.sender_id, dm.recipient_id, dm.content, dm.is_read, dm.created_at,
                    u.display_name as sender_name, u.avatar_url as sender_avatar
             FROM direct_messages dm
             JOIN users u ON u.id = dm.sender_id
             WHERE (dm.sender_id = ? AND dm.recipient_id = ?) OR (dm.sender_id = ? AND dm.recipient_id = ?)
             ORDER BY dm.created_at DESC
             LIMIT ?"
        )
        .bind(&claims.user_id)
        .bind(&user_id)
        .bind(&user_id)
        .bind(&claims.user_id)
        .bind(fetch_limit)
        .fetch_all(&state.pool)
        .await?
    };

    let has_more = messages.len() as i64 > limit;
    if has_more {
        messages.truncate(limit as usize);
    }

    // Results came in DESC order; reverse to ASC for display
    messages.reverse();

    Ok(Json(PaginatedMessages { messages, has_more }))
}

pub async fn send_message(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(recipient_id): Path<String>,
    Json(body): Json<CreateDirectMessage>,
) -> AppResult<Json<DirectMessageDetail>> {
    let content = body.content.trim().to_string();
    if content.is_empty() {
        return Err(AppError::BadRequest("Message cannot be empty".into()));
    }
    if content.len() > 10_000 {
        return Err(AppError::BadRequest("Message too long (max 10000 chars)".into()));
    }

    // Verify recipient exists
    let exists: bool = sqlx::query_scalar("SELECT COUNT(*) > 0 FROM users WHERE id = ?")
        .bind(&recipient_id)
        .fetch_one(&state.pool)
        .await?;

    if !exists {
        return Err(AppError::NotFound("User not found".into()));
    }

    if recipient_id == claims.user_id {
        return Err(AppError::BadRequest("Cannot send messages to yourself".into()));
    }

    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO direct_messages (id, sender_id, recipient_id, content) VALUES (?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(&claims.user_id)
    .bind(&recipient_id)
    .bind(&content)
    .execute(&state.pool)
    .await?;

    // Get sender info
    let sender_name: String = sqlx::query_scalar("SELECT display_name FROM users WHERE id = ?")
        .bind(&claims.user_id)
        .fetch_optional(&state.pool)
        .await?
        .unwrap_or_default();

    // Notify recipient
    let _ = create_notification(
        &state.pool,
        &state.notifier,
        &recipient_id,
        "dm_received",
        &format!("New message from {}", if sender_name.is_empty() { "Someone" } else { &sender_name }),
        &content,
        None,
        Some(&claims.user_id),
    ).await;

    let message: DirectMessageDetail = sqlx::query_as(
        "SELECT dm.id, dm.sender_id, dm.recipient_id, dm.content, dm.is_read, dm.created_at,
                u.display_name as sender_name, u.avatar_url as sender_avatar
         FROM direct_messages dm
         JOIN users u ON u.id = dm.sender_id
         WHERE dm.id = ?"
    )
    .bind(&id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(message))
}
