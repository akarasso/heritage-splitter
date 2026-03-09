use axum::{
    extract::{Multipart, Path, State},
    http::{header, StatusCode},
    response::IntoResponse,
    Extension, Json,
};
use serde::Serialize;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::middleware::Claims;
use crate::AppState;

#[derive(Serialize)]
pub struct UploadResponse {
    pub key: String,
    pub url: String,
}

/// POST /api/images/upload — upload an image to MinIO
pub async fn upload_image(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> AppResult<Json<UploadResponse>> {
    let storage = state.storage.as_ref()
        .ok_or_else(|| AppError::Internal("Image storage not configured".into()))?;

    let mut file_data: Option<Vec<u8>> = None;
    let mut content_type: Option<String> = None;
    let mut category: Option<String> = None;

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "file" => {
                content_type = field.content_type().map(|s| s.to_string());
                file_data = Some(field.bytes().await
                    .map_err(|e| AppError::BadRequest(format!("Failed to read file: {}", e)))?
                    .to_vec());
            }
            "category" => {
                let text = field.text().await.unwrap_or_default();
                category = Some(text);
            }
            _ => {}
        }
    }

    let data = file_data.ok_or_else(|| AppError::BadRequest("No file provided".into()))?;
    let cat = category.unwrap_or_else(|| "nft".into());

    // Validate category
    if !["nft", "avatar", "logo"].contains(&cat.as_str()) {
        return Err(AppError::BadRequest("Category must be 'nft', 'avatar', or 'logo'".into()));
    }

    // Validate MIME type
    let mime = content_type.unwrap_or_else(|| "application/octet-stream".into());
    let allowed_mimes = ["image/png", "image/jpeg", "image/gif", "image/webp"];
    if !allowed_mimes.contains(&mime.as_str()) {
        return Err(AppError::BadRequest(format!("Invalid file type '{}'. Allowed: png, jpeg, gif, webp", mime)));
    }

    // Validate size per category
    let max_size = match cat.as_str() {
        "avatar" => 50 * 1024,       // 50 KB
        "logo" => 500 * 1024,        // 500 KB
        _ => 10 * 1024 * 1024,       // 10 MB for NFTs
    };
    if data.len() > max_size {
        return Err(AppError::BadRequest(format!(
            "File too large ({} bytes). Max for {}: {} bytes",
            data.len(), cat, max_size
        )));
    }

    // Determine extension from MIME
    let ext = match mime.as_str() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => "bin",
    };

    let key = format!("{}/{}.{}", cat, Uuid::new_v4(), ext);
    storage.upload(&key, data, &mime).await
        .map_err(|e| AppError::Internal(format!("Upload failed: {}", e)))?;

    tracing::info!("Image uploaded: {} by user {}", key, claims.user_id);

    Ok(Json(UploadResponse {
        url: format!("/api/images/storage/{}", key),
        key,
    }))
}

/// GET /api/images/avatar/{userId} — proxy avatar from MinIO
pub async fn avatar_image(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let image_url: Option<String> = sqlx::query_scalar(
        "SELECT avatar_url FROM users WHERE id = ?"
    )
    .bind(&user_id)
    .fetch_optional(&state.pool)
    .await?
    .flatten();

    let image_url = image_url
        .ok_or_else(|| AppError::NotFound("User or avatar not found".into()))?;

    serve_image(&state, &image_url).await
}

/// GET /api/images/logo/{projectId} — proxy logo from MinIO
pub async fn logo_image(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let image_url: Option<String> = sqlx::query_scalar(
        "SELECT logo_url FROM projects WHERE id = ?"
    )
    .bind(&project_id)
    .fetch_optional(&state.pool)
    .await?
    .flatten();

    let image_url = image_url
        .ok_or_else(|| AppError::NotFound("Project or logo not found".into()))?;

    serve_image(&state, &image_url).await
}

/// GET /api/images/storage/{*key} — proxy any image from MinIO by storage key
pub async fn storage_image(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    validate_minio_key(&key)?;
    let storage = state.storage.as_ref()
        .ok_or_else(|| AppError::Internal("Image storage not configured".into()))?;
    let (bytes, content_type) = storage.get(&key).await
        .map_err(|e| AppError::Internal(format!("Storage get failed: {}", e)))?;

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, "public, max-age=31536000, immutable".into()),
        ],
        bytes,
    ))
}

/// Validate a MinIO key: reject path traversal and unsafe characters
fn validate_minio_key(key: &str) -> Result<(), AppError> {
    if key.contains("..") || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '/' || c == '-') {
        return Err(AppError::BadRequest("Invalid storage key".into()));
    }
    Ok(())
}

/// Serve an image from MinIO (by key) or inline data URI
async fn serve_image(state: &AppState, image_url: &str) -> Result<impl IntoResponse, AppError> {
    // Strip legacy minio:// prefix if present, otherwise treat as raw key
    let maybe_key = image_url.strip_prefix("minio://").unwrap_or(image_url);
    if !maybe_key.starts_with("data:") {
        validate_minio_key(maybe_key)?;
        // Fetch from MinIO
        let storage = state.storage.as_ref()
            .ok_or_else(|| AppError::Internal("Image storage not configured".into()))?;
        let (bytes, content_type) = storage.get(maybe_key).await
            .map_err(|e| AppError::Internal(format!("Storage get failed: {}", e)))?;

        Ok((
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, content_type),
                (header::CACHE_CONTROL, "public, max-age=31536000, immutable".into()),
            ],
            bytes,
        ))
    } else if image_url.starts_with("data:") {
        // Legacy base64 data URI
        let data_uri = image_url.strip_prefix("data:").unwrap();
        let (mime, b64) = data_uri.split_once(",")
            .ok_or_else(|| AppError::Internal("Invalid data URI format".into()))?;
        let content_type = mime.split(';').next().unwrap_or("image/png");
        let content_type = match content_type {
            "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml" => content_type.to_string(),
            _ => "application/octet-stream".to_string(),
        };
        let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64)
            .map_err(|e| AppError::Internal(format!("Base64 decode error: {}", e)))?;

        Ok((
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, content_type),
                (header::CACHE_CONTROL, "public, max-age=31536000, immutable".into()),
            ],
            bytes,
        ))
    } else {
        Err(AppError::NotFound("No embedded or stored image".into()))
    }
}
