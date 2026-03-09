use axum::{extract::{State, Path, Query}, Extension, Json};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::middleware::Claims;
use crate::models::{User, UpdateUser};
use crate::AppState;

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
    pub role: Option<String>,
}

/// Public user representation — no wallet_address exposed
#[derive(Serialize)]
pub struct PublicUser {
    pub id: String,
    pub display_name: String,
    pub role: String,
    pub bio: String,
    pub avatar_url: String,
    pub artist_number: String,
    pub created_at: String,
}

impl From<User> for PublicUser {
    fn from(u: User) -> Self {
        Self {
            id: u.id,
            display_name: u.display_name,
            role: u.role,
            bio: u.bio,
            avatar_url: u.avatar_url,
            artist_number: u.artist_number,
            created_at: u.created_at.to_string(),
        }
    }
}

pub async fn get_me(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
) -> AppResult<Json<User>> {
    let user: User = sqlx::query_as("SELECT * FROM users WHERE id = ?")
        .bind(&claims.user_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".into()))?;

    Ok(Json(user))
}

pub async fn update_me(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Json(body): Json<UpdateUser>,
) -> AppResult<Json<User>> {
    if let Some(ref name) = body.display_name {
        let trimmed = name.trim();
        if trimmed.len() > 100 {
            return Err(AppError::BadRequest("Display name too long (max 100 chars)".into()));
        }
        sqlx::query("UPDATE users SET display_name = ? WHERE id = ?")
            .bind(trimmed).bind(&claims.user_id).execute(&state.pool).await?;
    }
    if let Some(ref role) = body.role {
        const ALLOWED_ROLES: &[&str] = &["artist", "producer"];
        if !ALLOWED_ROLES.contains(&role.as_str()) {
            return Err(AppError::BadRequest(format!("Invalid role: {}", role)));
        }
        sqlx::query("UPDATE users SET role = ? WHERE id = ?")
            .bind(role).bind(&claims.user_id).execute(&state.pool).await?;
    }
    if let Some(ref bio) = body.bio {
        if bio.len() > 2000 {
            return Err(AppError::BadRequest("Bio too long (max 2000 chars)".into()));
        }
        sqlx::query("UPDATE users SET bio = ? WHERE id = ?")
            .bind(bio).bind(&claims.user_id).execute(&state.pool).await?;
    }
    if let Some(ref avatar) = body.avatar_url {
        if avatar.len() > 10_000 {
            return Err(AppError::BadRequest("Avatar URL too long (max 10KB)".into()));
        }
        if !avatar.is_empty()
            && !avatar.starts_with("data:image/")
            && !avatar.starts_with("https://")
            && !avatar.starts_with("avatar/")
        {
            return Err(AppError::BadRequest("Avatar must be a data:image/ URI, https:// URL, or storage key".into()));
        }
        sqlx::query("UPDATE users SET avatar_url = ? WHERE id = ?")
            .bind(avatar).bind(&claims.user_id).execute(&state.pool).await?;
    }
    if let Some(ref artist_number) = body.artist_number {
        sqlx::query("UPDATE users SET artist_number = ? WHERE id = ?")
            .bind(artist_number).bind(&claims.user_id).execute(&state.pool).await?;
    }

    let user: User = sqlx::query_as("SELECT * FROM users WHERE id = ?")
        .bind(&claims.user_id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(user))
}

pub async fn list_users(
    State(state): State<AppState>,
    Query(params): Query<SearchQuery>,
) -> AppResult<Json<Vec<PublicUser>>> {
    let users: Vec<User> = match (&params.q, &params.role) {
        (Some(q), Some(role)) => {
            let pattern = format!("%{}%", q);
            sqlx::query_as(
                "SELECT * FROM users WHERE display_name != '' AND role = ? AND (display_name LIKE ? OR bio LIKE ?) ORDER BY display_name LIMIT 100"
            )
            .bind(role)
            .bind(&pattern)
            .bind(&pattern)
            .fetch_all(&state.pool)
            .await?
        }
        (Some(q), None) => {
            let pattern = format!("%{}%", q);
            sqlx::query_as(
                "SELECT * FROM users WHERE display_name != '' AND (display_name LIKE ? OR bio LIKE ?) ORDER BY display_name LIMIT 100"
            )
            .bind(&pattern)
            .bind(&pattern)
            .fetch_all(&state.pool)
            .await?
        }
        (None, Some(role)) => {
            sqlx::query_as(
                "SELECT * FROM users WHERE display_name != '' AND role = ? ORDER BY display_name LIMIT 100"
            )
            .bind(role)
            .fetch_all(&state.pool)
            .await?
        }
        (None, None) => {
            sqlx::query_as(
                "SELECT * FROM users WHERE display_name != '' ORDER BY created_at DESC LIMIT 100"
            )
            .fetch_all(&state.pool)
            .await?
        }
    };

    Ok(Json(users.into_iter().map(PublicUser::from).collect()))
}

pub async fn get_user_by_wallet(
    State(state): State<AppState>,
    Path(wallet): Path<String>,
) -> AppResult<Json<PublicUser>> {
    let user: User = sqlx::query_as("SELECT * FROM users WHERE LOWER(wallet_address) = LOWER(?)")
        .bind(wallet.to_lowercase())
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".into()))?;

    Ok(Json(PublicUser::from(user)))
}
