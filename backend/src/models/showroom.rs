use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, utoipa::ToSchema)]
pub struct Showroom {
    pub id: String,
    pub name: String,
    pub description: String,
    pub status: String,
    pub creator_id: String,
    pub contract_address: Option<String>,
    pub public_slug: Option<String>,
    pub is_public: bool,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateShowroom {
    pub name: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateShowroom {
    pub name: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, utoipa::ToSchema)]
pub struct ShowroomParticipant {
    pub id: String,
    pub showroom_id: String,
    pub user_id: String,
    pub status: String,
    pub invited_at: NaiveDateTime,
    pub accepted_at: Option<NaiveDateTime>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct InviteToShowroom {
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, utoipa::ToSchema)]
pub struct ShowroomListing {
    pub id: String,
    pub showroom_id: String,
    pub nft_contract: String,
    pub token_id: i64,
    pub base_price: String,
    pub margin: String,
    pub proposed_by: String,
    pub status: String,
    pub title: String,
    pub image_url: String,
    pub artist_name: String,
    pub collection_id: Option<String>,
    pub collection_name: String,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateShowroomListing {
    pub nft_contract: String,
    pub token_id: i64,
    #[serde(default)]
    pub base_price: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateShowroomListing {
    pub margin: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct ProposeCollection {
    pub collection_id: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct BatchMarginUpdate {
    pub listing_ids: Vec<String>,
    pub margin: String,
}

impl Showroom {
    pub fn new(creator_id: String, data: CreateShowroom) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: data.name,
            description: data.description,
            status: "draft".into(),
            creator_id,
            contract_address: None,
            public_slug: None,
            is_public: false,
            created_at: chrono::Utc::now().naive_utc(),
        }
    }
}
