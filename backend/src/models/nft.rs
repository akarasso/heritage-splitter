use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, utoipa::ToSchema)]
pub struct Nft {
    pub id: String,
    pub project_id: String,
    pub token_id: i64,
    pub metadata_uri: String,
    pub title: String,
    pub artist_name: String,
    pub description: String,
    pub image_url: String,
    pub price: String,
    pub attributes: String,
    pub phase: String,
    pub collection_id: Option<String>,
    pub minted_at: NaiveDateTime,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct MintNft {
    pub title: String,
    #[serde(default)]
    pub artist_name: Option<String>,
    #[serde(default)]
    pub draft_nft_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, utoipa::ToSchema)]
pub struct DraftNft {
    pub id: String,
    pub collection_id: String,
    pub title: String,
    pub description: String,
    pub artist_name: String,
    pub price: String,
    pub image_url: String,
    pub metadata_uri: String,
    pub attributes: String,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateDraftNft {
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub artist_name: Option<String>,
    #[serde(default)]
    pub price: Option<String>,
    #[serde(default)]
    pub image_url: Option<String>,
    #[serde(default)]
    pub metadata_uri: Option<String>,
    #[serde(default)]
    pub attributes: Option<String>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateDraftNft {
    pub title: Option<String>,
    pub description: Option<String>,
    pub artist_name: Option<String>,
    pub price: Option<String>,
    pub image_url: Option<String>,
    pub metadata_uri: Option<String>,
    pub attributes: Option<String>,
}
