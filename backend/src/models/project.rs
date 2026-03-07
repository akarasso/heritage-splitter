use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, utoipa::ToSchema)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: String,
    pub status: String,
    pub creator_id: String,
    pub royalty_bps: i64,
    pub contract_nft_address: Option<String>,
    pub contract_splitter_address: Option<String>,
    pub logo_url: String,
    pub max_participants: Option<i64>,
    pub completed_at: Option<NaiveDateTime>,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateProject {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_royalty")]
    pub royalty_bps: i64,
    #[serde(default)]
    pub logo_url: String,
    pub max_participants: Option<i64>,
}

fn default_royalty() -> i64 { 0 }

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateProject {
    pub name: Option<String>,
    pub description: Option<String>,
    pub royalty_bps: Option<i64>,
    pub logo_url: Option<String>,
}

impl Project {
    pub fn new(creator_id: String, data: CreateProject) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: data.name,
            description: data.description,
            status: "active".into(),
            creator_id,
            royalty_bps: data.royalty_bps,
            contract_nft_address: None,
            contract_splitter_address: None,
            logo_url: data.logo_url,
            max_participants: data.max_participants,
            completed_at: None,
            created_at: chrono::Utc::now().naive_utc(),
        }
    }
}
