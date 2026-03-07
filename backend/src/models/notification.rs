use chrono::NaiveDateTime;
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, FromRow, Serialize, Clone, utoipa::ToSchema)]
pub struct Notification {
    pub id: String,
    pub user_id: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub project_id: Option<String>,
    pub reference_id: Option<String>,
    pub is_read: bool,
    pub created_at: NaiveDateTime,
}
