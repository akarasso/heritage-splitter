use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, FromRow, Serialize, Clone, utoipa::ToSchema)]
pub struct DirectMessageDetail {
    pub id: String,
    pub sender_id: String,
    pub recipient_id: String,
    pub content: String,
    pub is_read: bool,
    pub created_at: NaiveDateTime,
    pub sender_name: String,
    pub sender_avatar: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateDirectMessage {
    pub content: String,
}
