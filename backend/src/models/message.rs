use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, utoipa::ToSchema)]
pub struct MessageDetail {
    pub id: String,
    pub project_id: String,
    pub thread_id: String,
    pub user_id: String,
    pub content: String,
    pub created_at: NaiveDateTime,
    pub display_name: String,
    pub avatar_url: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateMessage {
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, utoipa::ToSchema)]
pub struct Thread {
    pub id: String,
    pub project_id: String,
    pub author_id: String,
    pub title: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub concluded_by: Option<String>,
    pub collection_id: Option<String>,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct ThreadDetail {
    pub id: String,
    pub project_id: String,
    pub author_id: String,
    pub title: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub concluded_by: Option<String>,
    pub collection_id: Option<String>,
    pub created_at: NaiveDateTime,
    pub author_name: String,
    pub author_avatar: String,
    pub concluded_by_name: Option<String>,
    pub message_count: i64,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateThread {
    pub title: String,
    pub content: String,
    pub collection_id: Option<String>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct ResolveThread {
    pub conclusion: String,
}
