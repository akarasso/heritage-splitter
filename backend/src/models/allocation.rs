use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, utoipa::ToSchema)]
pub struct Allocation {
    pub id: String,
    pub project_id: String,
    pub role: String,
    pub label: String,
    pub total_bps: i64,
    pub max_slots: Option<i64>,
    pub distribution_mode: String,
    pub sort_order: i64,
    pub receives_primary: bool,
    pub collection_id: Option<String>,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateAllocation {
    #[serde(default = "default_role")]
    pub role: String,
    pub label: String,
    pub total_bps: i64,
    pub max_slots: Option<i64>,
    #[serde(default = "default_distribution_mode")]
    pub distribution_mode: String,
    #[serde(default)]
    pub sort_order: i64,
    #[serde(default)]
    pub receives_primary: bool,
    pub collection_id: Option<String>,
}

fn default_role() -> String {
    "artist".into()
}

fn default_distribution_mode() -> String {
    "equal".into()
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateAllocation {
    pub role: Option<String>,
    pub label: Option<String>,
    pub total_bps: Option<i64>,
    pub max_slots: Option<Option<i64>>,
    pub distribution_mode: Option<String>,
    pub sort_order: Option<i64>,
    pub receives_primary: Option<bool>,
}

impl Allocation {
    pub fn new(project_id: String, data: CreateAllocation) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            project_id,
            role: data.role,
            label: data.label,
            total_bps: data.total_bps,
            max_slots: data.max_slots,
            distribution_mode: data.distribution_mode,
            sort_order: data.sort_order,
            receives_primary: data.receives_primary,
            collection_id: data.collection_id,
            created_at: chrono::Utc::now().naive_utc(),
        }
    }
}
