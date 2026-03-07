use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, utoipa::ToSchema)]
pub struct Work {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub description: String,
    pub work_type: String,
    pub status: String,
    pub royalty_bps: i64,
    pub contract_nft_address: Option<String>,
    pub contract_splitter_address: Option<String>,
    pub contract_vault_address: Option<String>,
    pub public_slug: Option<String>,
    pub is_public: bool,
    pub deploy_block_number: Option<i64>,
    pub completed_at: Option<NaiveDateTime>,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateWork {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_work_type")]
    pub work_type: String,
    #[serde(default = "default_royalty_bps")]
    pub royalty_bps: i64,
}

fn default_work_type() -> String {
    "nft_collection".into()
}

fn default_royalty_bps() -> i64 {
    1000
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateWork {
    pub name: Option<String>,
    pub description: Option<String>,
    pub royalty_bps: Option<i64>,
}

impl Work {
    pub fn new(project_id: String, data: CreateWork) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            project_id,
            name: data.name,
            description: data.description,
            work_type: data.work_type,
            status: "draft".into(),
            royalty_bps: data.royalty_bps,
            contract_nft_address: None,
            contract_splitter_address: None,
            contract_vault_address: None,
            public_slug: None,
            is_public: false,
            deploy_block_number: None,
            completed_at: None,
            created_at: chrono::Utc::now().naive_utc(),
        }
    }
}
