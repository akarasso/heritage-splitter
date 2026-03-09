use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, utoipa::ToSchema)]
pub struct Collection {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub description: String,
    pub collection_type: String,
    pub status: String,
    pub royalty_bps: i64,
    pub contract_nft_address: Option<String>,
    pub contract_splitter_address: Option<String>,
    pub contract_market_address: Option<String>,
    pub public_slug: Option<String>,
    pub is_public: bool,
    pub deploy_block_number: Option<i64>,
    pub completed_at: Option<NaiveDateTime>,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateCollection {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_collection_type")]
    pub collection_type: String,
    #[serde(default = "default_royalty_bps")]
    pub royalty_bps: i64,
}

fn default_collection_type() -> String {
    "nft_collection".into()
}

fn default_royalty_bps() -> i64 {
    1000
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateCollection {
    pub name: Option<String>,
    pub description: Option<String>,
    pub royalty_bps: Option<i64>,
}

impl Collection {
    pub fn new(project_id: String, data: CreateCollection) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            project_id,
            name: data.name,
            description: data.description,
            collection_type: data.collection_type,
            status: "draft".into(),
            royalty_bps: data.royalty_bps,
            contract_nft_address: None,
            contract_splitter_address: None,
            contract_market_address: None,
            public_slug: None,
            is_public: false,
            deploy_block_number: None,
            completed_at: None,
            created_at: chrono::Utc::now().naive_utc(),
        }
    }
}
