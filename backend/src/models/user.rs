use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, utoipa::ToSchema)]
pub struct User {
    pub id: String,
    pub wallet_address: String,
    pub display_name: String,
    pub role: String,
    pub bio: String,
    pub avatar_url: String,
    pub artist_number: String,
    pub is_bot: bool,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateUser {
    pub display_name: Option<String>,
    pub role: Option<String>,
    pub bio: Option<String>,
    pub avatar_url: Option<String>,
    pub artist_number: Option<String>,
}
