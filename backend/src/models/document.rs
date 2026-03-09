use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, utoipa::ToSchema)]
pub struct Document {
    pub id: String,
    pub project_id: String,
    pub showroom_id: Option<String>,
    pub uploader_id: String,
    pub original_name: String,
    pub mime_type: String,
    pub file_size: i64,
    #[serde(skip_serializing)]
    pub stored_path: String,
    pub sha256_hash: String,
    #[serde(skip_serializing)]
    pub encryption_key: String,
    #[serde(skip_serializing)]
    pub encryption_iv: String,
    pub tx_hash: Option<String>,
    pub certified_at: Option<String>,
    pub certified_by: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DocumentResponse {
    pub id: String,
    pub project_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub showroom_id: Option<String>,
    pub uploader_id: String,
    pub original_name: String,
    pub mime_type: String,
    pub file_size: i64,
    pub sha256_hash: String,
    pub tx_hash: Option<String>,
    pub certified_at: Option<String>,
    pub certified_by: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_project_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_certified_by: Option<String>,
}

impl From<Document> for DocumentResponse {
    fn from(d: Document) -> Self {
        Self {
            id: d.id,
            project_id: d.project_id,
            showroom_id: d.showroom_id,
            uploader_id: d.uploader_id,
            original_name: d.original_name,
            mime_type: d.mime_type,
            file_size: d.file_size,
            sha256_hash: d.sha256_hash,
            tx_hash: d.tx_hash,
            certified_at: d.certified_at,
            certified_by: d.certified_by,
            created_at: d.created_at,
            original_project_id: None,
            original_project_name: None,
            original_certified_by: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, utoipa::ToSchema)]
pub struct DocumentAccess {
    pub id: String,
    pub document_id: String,
    pub user_id: String,
    pub granted_by: String,
    pub granted_at: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct ShareDocumentRequest {
    pub user_ids: Vec<String>,
}
