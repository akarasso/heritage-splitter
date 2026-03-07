use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, utoipa::ToSchema)]
pub struct Participant {
    pub id: String,
    pub project_id: String,
    pub user_id: Option<String>,
    pub wallet_address: String,
    pub role: String,
    pub shares_bps: i64,
    pub status: String,
    pub allocation_id: Option<String>,
    pub invited_at: NaiveDateTime,
    pub accepted_at: Option<NaiveDateTime>,
    pub approved_at: Option<NaiveDateTime>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateParticipant {
    #[serde(default)]
    pub wallet_address: String,
    #[serde(default)]
    pub user_id: Option<String>,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub shares_bps: i64,
    pub allocation_id: Option<String>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateParticipant {
    pub role: Option<String>,
    pub shares_bps: Option<i64>,
}

impl Participant {
    pub fn new(project_id: String, data: CreateParticipant) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            project_id,
            user_id: None,
            wallet_address: data.wallet_address,
            role: data.role,
            shares_bps: data.shares_bps,
            status: "invited".into(),
            allocation_id: data.allocation_id,
            invited_at: chrono::Utc::now().naive_utc(),
            accepted_at: None,
            approved_at: None,
        }
    }
}
