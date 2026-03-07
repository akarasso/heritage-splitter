use axum::{extract::{State, Path, Query}, Extension, Json};
use serde::Deserialize;
use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::middleware::Claims;
use crate::models::{Thread, ThreadDetail, CreateThread, ResolveThread, MessageDetail, CreateMessage, Participant};
use crate::services::notifications::create_notification;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct ListMessagesQuery {
    pub since: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListThreadsQuery {
    pub work_id: Option<String>,
}

// ── Threads ──

pub async fn list_threads(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Query(query): Query<ListThreadsQuery>,
) -> AppResult<Json<Vec<ThreadDetail>>> {
    verify_project_member(&state.pool, &project_id, &claims).await?;

    let threads: Vec<Thread> = if let Some(ref work_id) = query.work_id {
        sqlx::query_as(
            "SELECT * FROM threads WHERE project_id = ? AND work_id = ? ORDER BY created_at DESC LIMIT 200"
        )
        .bind(&project_id)
        .bind(work_id)
        .fetch_all(&state.pool)
        .await?
    } else {
        sqlx::query_as(
            "SELECT * FROM threads WHERE project_id = ? AND work_id IS NULL ORDER BY created_at DESC LIMIT 200"
        )
        .bind(&project_id)
        .fetch_all(&state.pool)
        .await?
    };

    let mut result = Vec::new();
    for t in threads {
        let (author_name, author_avatar) = get_user_info(&state.pool, &t.author_id).await;
        let concluded_by_name = if let Some(ref uid) = t.concluded_by {
            Some(get_user_info(&state.pool, uid).await.0)
        } else {
            None
        };
        let message_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM messages WHERE thread_id = ?"
        )
        .bind(&t.id)
        .fetch_one(&state.pool)
        .await?;

        result.push(ThreadDetail {
            id: t.id,
            project_id: t.project_id,
            author_id: t.author_id,
            title: t.title,
            status: t.status,
            conclusion: t.conclusion,
            concluded_by: t.concluded_by,
            work_id: t.work_id,
            created_at: t.created_at,
            author_name,
            author_avatar,
            concluded_by_name,
            message_count,
        });
    }

    Ok(Json(result))
}

pub async fn create_thread(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(body): Json<CreateThread>,
) -> AppResult<Json<ThreadDetail>> {
    verify_project_member(&state.pool, &project_id, &claims).await?;

    let title = body.title.trim().to_string();
    let content = body.content.trim().to_string();
    if title.is_empty() {
        return Err(AppError::BadRequest("Title cannot be empty".into()));
    }
    if title.len() > 300 {
        return Err(AppError::BadRequest("Title too long (max 300 chars)".into()));
    }
    if content.len() > 10_000 {
        return Err(AppError::BadRequest("Content too long (max 10000 chars)".into()));
    }

    // B2-9: Validate work_id length (UUID max 36 chars)
    if let Some(ref wid) = body.work_id {
        if wid.len() > 36 {
            return Err(AppError::BadRequest("work_id too long (max 36 chars)".into()));
        }
    }

    let thread_id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO threads (id, project_id, author_id, title, work_id) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(&thread_id)
    .bind(&project_id)
    .bind(&claims.user_id)
    .bind(&title)
    .bind(&body.work_id)
    .execute(&state.pool)
    .await?;

    // Create first message in thread if content provided
    let mut message_count: i64 = 0;
    if !content.is_empty() {
        let msg_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO messages (id, project_id, thread_id, user_id, content) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(&msg_id)
        .bind(&project_id)
        .bind(&thread_id)
        .bind(&claims.user_id)
        .bind(&content)
        .execute(&state.pool)
        .await?;
        message_count = 1;
    }

    // Notify other project members
    let members = get_project_member_ids(&state.pool, &project_id).await;
    let author_name = get_user_info(&state.pool, &claims.user_id).await.0;
    let project_name: String = sqlx::query_scalar("SELECT name FROM projects WHERE id = ?")
        .bind(&project_id)
        .fetch_optional(&state.pool)
        .await?
        .unwrap_or_default();

    for uid in &members {
        if uid != &claims.user_id {
            let _ = create_notification(
                &state.pool,
                &state.notifier,
                uid,
                "thread_created",
                &format!("{} started a discussion in {}", if author_name.is_empty() { "Someone" } else { &author_name }, &project_name),
                &title,
                Some(&project_id),
                Some(&thread_id),
            ).await;
        }
    }

    let thread: Thread = sqlx::query_as("SELECT * FROM threads WHERE id = ?")
        .bind(&thread_id)
        .fetch_one(&state.pool)
        .await?;

    let (author_name, author_avatar) = get_user_info(&state.pool, &claims.user_id).await;

    Ok(Json(ThreadDetail {
        id: thread.id,
        project_id: thread.project_id,
        author_id: thread.author_id,
        title: thread.title,
        status: thread.status,
        conclusion: thread.conclusion,
        concluded_by: thread.concluded_by,
        work_id: thread.work_id,
        created_at: thread.created_at,
        author_name,
        author_avatar,
        concluded_by_name: None,
        message_count,
    }))
}

pub async fn resolve_thread(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(thread_id): Path<String>,
    Json(body): Json<ResolveThread>,
) -> AppResult<Json<ThreadDetail>> {
    let thread: Thread = sqlx::query_as("SELECT * FROM threads WHERE id = ?")
        .bind(&thread_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Thread not found".into()))?;

    verify_project_member(&state.pool, &thread.project_id, &claims).await?;

    let conclusion = body.conclusion.trim().to_string();
    if conclusion.len() > 5000 {
        return Err(AppError::BadRequest("Conclusion too long (max 5000 chars)".into()));
    }

    sqlx::query(
        "UPDATE threads SET status = 'resolved', conclusion = ?, concluded_by = ? WHERE id = ?"
    )
    .bind(&conclusion)
    .bind(&claims.user_id)
    .bind(&thread_id)
    .execute(&state.pool)
    .await?;

    // Notify other members
    let members = get_project_member_ids(&state.pool, &thread.project_id).await;
    let resolver_name = get_user_info(&state.pool, &claims.user_id).await.0;
    let project_name: String = sqlx::query_scalar("SELECT name FROM projects WHERE id = ?")
        .bind(&thread.project_id)
        .fetch_optional(&state.pool)
        .await?
        .unwrap_or_default();

    for uid in &members {
        if uid != &claims.user_id {
            let _ = create_notification(
                &state.pool,
                &state.notifier,
                uid,
                "thread_resolved",
                &format!("{} resolved a discussion in {}", if resolver_name.is_empty() { "Someone" } else { &resolver_name }, &project_name),
                &thread.title,
                Some(&thread.project_id),
                Some(&thread_id),
            ).await;
        }
    }

    let updated: Thread = sqlx::query_as("SELECT * FROM threads WHERE id = ?")
        .bind(&thread_id)
        .fetch_one(&state.pool)
        .await?;

    let (author_name, author_avatar) = get_user_info(&state.pool, &updated.author_id).await;
    let concluded_by_name = Some(get_user_info(&state.pool, &claims.user_id).await.0);
    let message_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM messages WHERE thread_id = ?"
    )
    .bind(&thread_id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(ThreadDetail {
        id: updated.id,
        project_id: updated.project_id,
        author_id: updated.author_id,
        title: updated.title,
        status: updated.status,
        conclusion: updated.conclusion,
        concluded_by: updated.concluded_by,
        work_id: updated.work_id,
        created_at: updated.created_at,
        author_name,
        author_avatar,
        concluded_by_name,
        message_count,
    }))
}

pub async fn reopen_thread(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(thread_id): Path<String>,
) -> AppResult<Json<ThreadDetail>> {
    let thread: Thread = sqlx::query_as("SELECT * FROM threads WHERE id = ?")
        .bind(&thread_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Thread not found".into()))?;

    verify_project_member(&state.pool, &thread.project_id, &claims).await?;

    sqlx::query(
        "UPDATE threads SET status = 'open', conclusion = NULL, concluded_by = NULL WHERE id = ?"
    )
    .bind(&thread_id)
    .execute(&state.pool)
    .await?;

    let updated: Thread = sqlx::query_as("SELECT * FROM threads WHERE id = ?")
        .bind(&thread_id)
        .fetch_one(&state.pool)
        .await?;

    let (author_name, author_avatar) = get_user_info(&state.pool, &updated.author_id).await;
    let message_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM messages WHERE thread_id = ?"
    )
    .bind(&thread_id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(ThreadDetail {
        id: updated.id,
        project_id: updated.project_id,
        author_id: updated.author_id,
        title: updated.title,
        status: updated.status,
        conclusion: updated.conclusion,
        concluded_by: updated.concluded_by,
        work_id: updated.work_id,
        created_at: updated.created_at,
        author_name,
        author_avatar,
        concluded_by_name: None,
        message_count,
    }))
}

// ── Messages ──

pub async fn list_messages(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(thread_id): Path<String>,
    Query(query): Query<ListMessagesQuery>,
) -> AppResult<Json<Vec<MessageDetail>>> {
    let thread: Thread = sqlx::query_as("SELECT * FROM threads WHERE id = ?")
        .bind(&thread_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Thread not found".into()))?;

    verify_project_member(&state.pool, &thread.project_id, &claims).await?;

    let messages = if let Some(since) = query.since {
        sqlx::query_as::<_, MessageDetail>(
            "SELECT m.id, m.project_id, m.thread_id, m.user_id, m.content, m.created_at,
                    u.display_name, u.avatar_url
             FROM messages m
             JOIN users u ON u.id = m.user_id
             WHERE m.thread_id = ? AND m.created_at > ?
             ORDER BY m.created_at ASC
             LIMIT 200"
        )
        .bind(&thread_id)
        .bind(&since)
        .fetch_all(&state.pool)
        .await?
    } else {
        sqlx::query_as::<_, MessageDetail>(
            "SELECT m.id, m.project_id, m.thread_id, m.user_id, m.content, m.created_at,
                    u.display_name, u.avatar_url
             FROM messages m
             JOIN users u ON u.id = m.user_id
             WHERE m.thread_id = ?
             ORDER BY m.created_at ASC
             LIMIT 200"
        )
        .bind(&thread_id)
        .fetch_all(&state.pool)
        .await?
    };

    Ok(Json(messages))
}

pub async fn create_message(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(thread_id): Path<String>,
    Json(body): Json<CreateMessage>,
) -> AppResult<Json<MessageDetail>> {
    let thread: Thread = sqlx::query_as("SELECT * FROM threads WHERE id = ?")
        .bind(&thread_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Thread not found".into()))?;

    verify_project_member(&state.pool, &thread.project_id, &claims).await?;

    let content = body.content.trim().to_string();
    if content.is_empty() {
        return Err(AppError::BadRequest("Message cannot be empty".into()));
    }
    if content.len() > 10_000 {
        return Err(AppError::BadRequest("Message too long (max 10000 chars)".into()));
    }

    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO messages (id, project_id, thread_id, user_id, content) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(&thread.project_id)
    .bind(&thread_id)
    .bind(&claims.user_id)
    .bind(&content)
    .execute(&state.pool)
    .await?;

    // Notify other project members
    let members = get_project_member_ids(&state.pool, &thread.project_id).await;
    let author_name = get_user_info(&state.pool, &claims.user_id).await.0;
    let project_name: String = sqlx::query_scalar("SELECT name FROM projects WHERE id = ?")
        .bind(&thread.project_id)
        .fetch_optional(&state.pool)
        .await?
        .unwrap_or_default();

    for uid in &members {
        if uid != &claims.user_id {
            let _ = create_notification(
                &state.pool,
                &state.notifier,
                uid,
                "message_posted",
                &format!("{} posted a message in {}", if author_name.is_empty() { "Someone" } else { &author_name }, &project_name),
                &content,
                Some(&thread.project_id),
                Some(&thread_id),
            ).await;
        }
    }

    let message: MessageDetail = sqlx::query_as(
        "SELECT m.id, m.project_id, m.thread_id, m.user_id, m.content, m.created_at,
                u.display_name, u.avatar_url
         FROM messages m
         JOIN users u ON u.id = m.user_id
         WHERE m.id = ?"
    )
    .bind(&id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(message))
}

// ── Helpers ──

async fn verify_project_member(
    pool: &SqlitePool,
    project_id: &str,
    claims: &Claims,
) -> AppResult<()> {
    let is_creator: bool = sqlx::query_scalar(
        "SELECT COUNT(*) > 0 FROM projects WHERE id = ? AND creator_id = ?"
    )
    .bind(project_id)
    .bind(&claims.user_id)
    .fetch_one(pool)
    .await?;

    if is_creator {
        return Ok(());
    }

    let is_participant: bool = sqlx::query_scalar(
        "SELECT COUNT(*) > 0 FROM participants WHERE project_id = ? AND wallet_address = ? AND status = 'accepted'"
    )
    .bind(project_id)
    .bind(&claims.sub)
    .fetch_one(pool)
    .await?;

    if is_participant {
        return Ok(());
    }

    Err(AppError::Forbidden("Not a member of this project".into()))
}

async fn get_user_info(pool: &SqlitePool, user_id: &str) -> (String, String) {
    #[derive(sqlx::FromRow)]
    struct UserInfo {
        display_name: String,
        avatar_url: String,
    }
    let info: Option<UserInfo> = sqlx::query_as(
        "SELECT display_name, avatar_url FROM users WHERE id = ?"
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    match info {
        Some(i) => (i.display_name, i.avatar_url),
        None => ("Inconnu".into(), String::new()),
    }
}

/// Get all member IDs (creator + accepted participants) for a project
async fn get_project_member_ids(pool: &SqlitePool, project_id: &str) -> Vec<String> {
    let mut ids = Vec::new();

    // Get creator
    let creator: Option<String> = sqlx::query_scalar("SELECT creator_id FROM projects WHERE id = ?")
        .bind(project_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();

    if let Some(cid) = creator {
        ids.push(cid);
    }

    // Get accepted participants
    let participants: Vec<Participant> = sqlx::query_as(
        "SELECT * FROM participants WHERE project_id = ? AND status = 'accepted' LIMIT 500"
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default(); // Empty vec on error is acceptable here — non-critical helper

    for p in participants {
        if let Some(uid) = p.user_id {
            if !ids.contains(&uid) {
                ids.push(uid);
            }
        }
    }

    ids
}
