use axum::{
    body::Body,
    extract::{Multipart, Path, State},
    http::{header, StatusCode},
    response::Response,
    Extension, Json,
};

use crate::error::{AppError, AppResult};
use crate::middleware::Claims;
use crate::models::{Document, DocumentAccess, DocumentResponse, ShareDocumentRequest, Project, Showroom};
use crate::services::audit::audit_log;
use crate::services::documents::{compute_sha256, decrypt_document, encrypt_document, certify_on_chain_for, get_certification_on_chain, get_certifier_on_chain, get_certifier_nonce_on_chain};
use crate::AppState;

#[derive(serde::Deserialize, Default)]
pub struct CertifyBody {
    pub signature: Option<String>,
    pub deadline: Option<u64>,
}

pub async fn upload_document(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    mut multipart: Multipart,
) -> AppResult<Json<DocumentResponse>> {
    let project: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
        .bind(&project_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".into()))?;

    if project.creator_id != claims.user_id {
        return Err(AppError::Forbidden("Only the creator can upload documents".into()));
    }

    let field = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("Multipart error: {}", e)))?
        .ok_or_else(|| AppError::BadRequest("No file provided".into()))?;

    let original_name = field.file_name().unwrap_or("document").to_string();
    let mime_type = field
        .content_type()
        .unwrap_or("application/octet-stream")
        .to_string();
    let data = field
        .bytes()
        .await
        .map_err(|e| AppError::BadRequest(format!("Failed to read file: {}", e)))?;

    let file_size = data.len() as i64;
    let sha256_hash = compute_sha256(&data);

    let (ciphertext, key_b64, iv_b64) =
        encrypt_document(&data).map_err(|e| AppError::Internal(e.to_string()))?;

    let doc_id = uuid::Uuid::new_v4().to_string();
    // Audit note (issue 5 — false positive): Path traversal is impossible here because
    // stored_filename is always a server-generated UUID (never user input). The canonical
    // path validation below is defense-in-depth only.
    let stored_filename = doc_id.clone();
    let stored_path = format!("{}/{}", state.config.document_storage_path, stored_filename);

    // Defense-in-depth: validate that the constructed path stays within storage directory
    let canonical_base = std::path::Path::new(&state.config.document_storage_path)
        .canonicalize()
        .map_err(|e| AppError::Internal(format!("Failed to resolve storage path: {}", e)))?;
    let parent = std::path::Path::new(&stored_path).parent()
        .ok_or_else(|| AppError::Internal("Invalid storage path".into()))?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| AppError::Internal(format!("Failed to resolve file path: {}", e)))?;
    if !canonical_parent.starts_with(&canonical_base) {
        return Err(AppError::Forbidden("Invalid document path".into()));
    }

    tokio::fs::write(&stored_path, &ciphertext)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to write file: {}", e)))?;

    // Sanitize original_name: strip path separators and special characters
    let sanitized_name = original_name
        .replace(['/', '\\', '\0', '\r', '\n'], "_")
        .trim_start_matches('.')
        .to_string();
    let sanitized_name = if sanitized_name.is_empty() { "document".to_string() } else { sanitized_name };

    sqlx::query(
        "INSERT INTO documents (id, project_id, uploader_id, original_name, mime_type, file_size, stored_path, sha256_hash, encryption_key, encryption_iv)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&doc_id)
    .bind(&project_id)
    .bind(&claims.user_id)
    .bind(&sanitized_name)
    .bind(&mime_type)
    .bind(file_size)
    .bind(&stored_filename)
    .bind(&sha256_hash)
    .bind(&key_b64)
    .bind(&iv_b64)
    .execute(&state.pool)
    .await?;

    let doc: Document = sqlx::query_as("SELECT * FROM documents WHERE id = ?")
        .bind(&doc_id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(DocumentResponse::from(doc)))
}

pub async fn list_documents(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> AppResult<Json<Vec<DocumentResponse>>> {
    let project: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
        .bind(&project_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".into()))?;

    let docs: Vec<Document> = if project.creator_id == claims.user_id {
        sqlx::query_as("SELECT * FROM documents WHERE project_id = ? ORDER BY created_at DESC LIMIT 200")
            .bind(&project_id)
            .fetch_all(&state.pool)
            .await?
    } else {
        sqlx::query_as(
            "SELECT d.* FROM documents d
             INNER JOIN document_access da ON da.document_id = d.id
             WHERE d.project_id = ? AND da.user_id = ?
             ORDER BY d.created_at DESC LIMIT 200",
        )
        .bind(&project_id)
        .bind(&claims.user_id)
        .fetch_all(&state.pool)
        .await?
    };

    let mut responses: Vec<DocumentResponse> = Vec::new();
    for doc in docs {
        let mut resp = DocumentResponse::from(doc.clone());
        if resp.certified_at.is_some() {
            // Find the earliest document with the same hash that has a real tx_hash
            let earliest: Option<Document> = sqlx::query_as(
                "SELECT * FROM documents WHERE sha256_hash = ? AND tx_hash IS NOT NULL AND tx_hash != '' ORDER BY certified_at ASC LIMIT 1",
            )
            .bind(&doc.sha256_hash)
            .fetch_optional(&state.pool)
            .await?;

            if let Some(ref orig) = earliest {
                // Propagate tx_hash if this doc doesn't have one
                if resp.tx_hash.as_ref().map_or(true, |h| h.is_empty()) {
                    resp.tx_hash = orig.tx_hash.clone();
                }
                // Only show the banner if THIS doc is NOT the original
                if orig.id != doc.id {
                    let proj: Option<Project> = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
                        .bind(&orig.project_id)
                        .fetch_optional(&state.pool)
                        .await?;
                    resp.original_project_id = Some(orig.project_id.clone());
                    resp.original_project_name = proj.map(|p| p.name);
                    resp.original_certified_by = orig.certified_by.clone();
                }
            }

            // Consistency check: if certified_at is set but tx_hash is still missing, clear certified_at
            if resp.tx_hash.as_ref().map_or(true, |h| h.is_empty()) {
                resp.certified_at = None;
            }
        }
        responses.push(resp);
    }
    Ok(Json(responses))
}

pub async fn download_document(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(doc_id): Path<String>,
) -> Result<Response, AppError> {
    let doc: Document = sqlx::query_as("SELECT * FROM documents WHERE id = ?")
        .bind(&doc_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Document not found".into()))?;

    // Check access based on owner type (project or showroom)
    let is_owner = if let Some(ref sid) = doc.showroom_id {
        if !sid.is_empty() {
            let showroom: Showroom = sqlx::query_as("SELECT * FROM showrooms WHERE id = ?")
                .bind(sid)
                .fetch_one(&state.pool)
                .await?;
            showroom.creator_id == claims.user_id
        } else {
            false
        }
    } else {
        let project: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
            .bind(&doc.project_id)
            .fetch_one(&state.pool)
            .await?;
        project.creator_id == claims.user_id
    };

    if !is_owner {
        let access: Option<DocumentAccess> = sqlx::query_as(
            "SELECT * FROM document_access WHERE document_id = ? AND user_id = ?",
        )
        .bind(&doc_id)
        .bind(&claims.user_id)
        .fetch_optional(&state.pool)
        .await?;
        if access.is_none() {
            return Err(AppError::Forbidden("No access to this document".into()));
        }
    }

    // Reconstruct full path from stored filename, then validate it stays within storage dir
    let full_stored_path = format!("{}/{}", state.config.document_storage_path, doc.stored_path);
    let canonical_stored = std::path::Path::new(&full_stored_path)
        .canonicalize()
        .map_err(|e| AppError::Internal(format!("Failed to resolve file path: {}", e)))?;
    let canonical_base = std::path::Path::new(&state.config.document_storage_path)
        .canonicalize()
        .map_err(|e| AppError::Internal(format!("Failed to resolve storage path: {}", e)))?;
    if !canonical_stored.starts_with(&canonical_base) {
        return Err(AppError::Forbidden("Invalid document path".into()));
    }

    let ciphertext = tokio::fs::read(&full_stored_path)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read file: {}", e)))?;

    let plaintext = decrypt_document(&ciphertext, &doc.encryption_key, &doc.encryption_iv)
        .map_err(|e| AppError::Internal(format!("Decryption failed: {}", e)))?;

    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, &doc.mime_type)
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", doc.original_name.replace('"', "_").replace('\r', "").replace('\n', "").replace('/', "_")),
        )
        .body(Body::from(plaintext))
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(response)
}

pub async fn certify_document(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(doc_id): Path<String>,
    body: Option<Json<CertifyBody>>,
) -> AppResult<Json<DocumentResponse>> {
    let body = body.map(|b| b.0).unwrap_or_default();
    let doc: Document = sqlx::query_as("SELECT * FROM documents WHERE id = ?")
        .bind(&doc_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Document not found".into()))?;

    let is_owner = if let Some(ref sid) = doc.showroom_id {
        if !sid.is_empty() {
            let showroom: Showroom = sqlx::query_as("SELECT * FROM showrooms WHERE id = ?")
                .bind(sid)
                .fetch_one(&state.pool)
                .await?;
            showroom.creator_id == claims.user_id
        } else {
            false
        }
    } else {
        let project: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
            .bind(&doc.project_id)
            .fetch_one(&state.pool)
            .await?;
        project.creator_id == claims.user_id
    };

    if !is_owner {
        return Err(AppError::Forbidden("Only the owner can certify documents".into()));
    }

    if doc.tx_hash.as_ref().is_some_and(|h| !h.is_empty()) {
        return Err(AppError::BadRequest("Document already certified".into()));
    }

    if state.config.certifier_private_key.is_empty() || state.config.doc_registry_address.is_empty() {
        return Err(AppError::Internal("Certifier not configured".into()));
    }

    // Check if this hash is already certified on-chain (same file uploaded twice)
    let existing_timestamp = get_certification_on_chain(
        &state.config.avalanche_rpc_url,
        &state.config.doc_registry_address,
        &doc.sha256_hash,
    )
    .await
    .unwrap_or(0);

    if existing_timestamp > 0 {
        // Read the on-chain certifier address
        let onchain_certifier = get_certifier_on_chain(
            &state.config.avalanche_rpc_url,
            &state.config.doc_registry_address,
            &doc.sha256_hash,
        )
        .await
        .unwrap_or_default();

        // Find the original document in DB with the tx_hash
        let existing: Option<Document> = sqlx::query_as(
            "SELECT * FROM documents WHERE sha256_hash = ? AND tx_hash IS NOT NULL AND tx_hash != '' LIMIT 1",
        )
        .bind(&doc.sha256_hash)
        .fetch_optional(&state.pool)
        .await?;

        // Get the original project info
        let (original_project_id, original_project_name) = if let Some(ref ex) = existing {
            let proj: Option<Project> = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
                .bind(&ex.project_id)
                .fetch_optional(&state.pool)
                .await?;
            (Some(ex.project_id.clone()), proj.map(|p| p.name))
        } else {
            (None, None)
        };

        let original_tx_hash = existing.as_ref().and_then(|d| d.tx_hash.clone()).filter(|s| !s.is_empty());
        let original_certified_by = existing.as_ref()
            .and_then(|d| d.certified_by.clone())
            .unwrap_or(onchain_certifier.clone());

        // Update this document with the blockchain info
        sqlx::query("UPDATE documents SET tx_hash = ?, certified_at = CURRENT_TIMESTAMP, certified_by = ? WHERE id = ?")
            .bind(&original_tx_hash)
            .bind(&original_certified_by)
            .bind(&doc_id)
            .execute(&state.pool)
            .await?;

        let updated: Document = sqlx::query_as("SELECT * FROM documents WHERE id = ?")
            .bind(&doc_id)
            .fetch_one(&state.pool)
            .await?;

        let mut response = DocumentResponse::from(updated);
        response.original_project_id = original_project_id;
        response.original_project_name = original_project_name;
        response.original_certified_by = Some(original_certified_by);

        return Ok(Json(response));
    }

    let (signature, deadline) = match (body.signature, body.deadline) {
        (Some(s), Some(d)) => (s, d),
        _ => return Err(AppError::BadRequest("Signature et deadline requises".into())),
    };

    // B2-2 + B3-4: Atomic claim FIRST — mark as "certifying" with tx_hash='pending' to prevent
    // concurrent certification AND signal to readers that certification is in progress.
    // This closes the window where concurrent reads see certified_by/certified_at set but no tx_hash.
    let claim_result = sqlx::query(
        "UPDATE documents SET certified_by = ?, certified_at = CURRENT_TIMESTAMP, tx_hash = 'pending' WHERE id = ? AND (tx_hash IS NULL OR tx_hash = '')"
    )
        .bind(&claims.sub)
        .bind(&doc_id)
        .execute(&state.pool)
        .await?;

    if claim_result.rows_affected() == 0 {
        return Err(AppError::BadRequest("Document was already certified concurrently".into()));
    }

    let tx_hash = match certify_on_chain_for(
        &state.config.avalanche_rpc_url,
        &state.config.certifier_private_key,
        &state.config.doc_registry_address,
        &doc.sha256_hash,
        &claims.sub,
        deadline,
        &signature,
    )
    .await
    {
        Ok(hash) => hash,
        Err(e) => {
            // Rollback the claim on blockchain failure: clear all certification fields
            let _ = sqlx::query(
                "UPDATE documents SET certified_by = NULL, certified_at = NULL, tx_hash = NULL WHERE id = ? AND tx_hash = 'pending'"
            )
                .bind(&doc_id)
                .execute(&state.pool)
                .await;
            return Err(AppError::Internal(format!("Certification failed: {}", e)));
        }
    };

    // Write the real tx_hash now that blockchain succeeded
    sqlx::query("UPDATE documents SET tx_hash = ? WHERE id = ?")
        .bind(&tx_hash)
        .bind(&doc_id)
        .execute(&state.pool)
        .await?;

    let updated: Document = sqlx::query_as("SELECT * FROM documents WHERE id = ?")
        .bind(&doc_id)
        .fetch_one(&state.pool)
        .await?;

    audit_log(&state.pool, &claims.user_id, "certify", "document", &doc_id, &format!("Document certified on-chain, tx={}", tx_hash)).await;

    Ok(Json(DocumentResponse::from(updated)))
}

pub async fn share_document(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(doc_id): Path<String>,
    Json(body): Json<ShareDocumentRequest>,
) -> AppResult<Json<Vec<DocumentAccess>>> {
    let doc: Document = sqlx::query_as("SELECT * FROM documents WHERE id = ?")
        .bind(&doc_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Document not found".into()))?;

    let is_owner = if let Some(ref sid) = doc.showroom_id {
        if !sid.is_empty() {
            let showroom: Showroom = sqlx::query_as("SELECT * FROM showrooms WHERE id = ?")
                .bind(sid)
                .fetch_one(&state.pool)
                .await?;
            showroom.creator_id == claims.user_id
        } else {
            false
        }
    } else {
        let project: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
            .bind(&doc.project_id)
            .fetch_one(&state.pool)
            .await?;
        project.creator_id == claims.user_id
    };

    if !is_owner {
        return Err(AppError::Forbidden("Only the owner can share documents".into()));
    }

    // B2-8: Reject empty user_ids list
    if body.user_ids.is_empty() {
        return Err(AppError::BadRequest("user_ids cannot be empty".into()));
    }
    if body.user_ids.len() > 100 {
        return Err(AppError::BadRequest("Cannot share with more than 100 users at once".into()));
    }

    for user_id in &body.user_ids {
        let access_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT OR IGNORE INTO document_access (id, document_id, user_id, granted_by)
             VALUES (?, ?, ?, ?)",
        )
        .bind(&access_id)
        .bind(&doc_id)
        .bind(user_id)
        .bind(&claims.user_id)
        .execute(&state.pool)
        .await?;
    }

    let accesses: Vec<DocumentAccess> =
        sqlx::query_as("SELECT * FROM document_access WHERE document_id = ? LIMIT 200")
            .bind(&doc_id)
            .fetch_all(&state.pool)
            .await?;

    Ok(Json(accesses))
}

pub async fn verify_document(
    State(state): State<AppState>,
    Path(sha256_hash): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    // Validate hex hash
    if sha256_hash.len() != 64 || hex::decode(&sha256_hash).is_err() {
        return Err(AppError::BadRequest("Invalid SHA-256 hash".into()));
    }

    // Check on-chain certification
    let timestamp = get_certification_on_chain(
        &state.config.avalanche_rpc_url,
        &state.config.doc_registry_address,
        &sha256_hash,
    )
    .await
    .map_err(|e| AppError::Internal(format!("On-chain verification failed: {}", e)))?;

    if timestamp == 0 {
        return Ok(Json(serde_json::json!({
            "certified": false,
            "timestamp": 0,
            "tx_hash": null,
            "document_name": null,
            "certified_at": null,
        })));
    }

    // Try to find document in DB for extra info
    let doc: Option<Document> = sqlx::query_as(
        "SELECT * FROM documents WHERE sha256_hash = ? AND tx_hash IS NOT NULL LIMIT 1",
    )
    .bind(&sha256_hash)
    .fetch_optional(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "certified": true,
        "timestamp": timestamp,
        "tx_hash": doc.as_ref().and_then(|d| d.tx_hash.clone()),
        "document_name": doc.as_ref().map(|d| d.original_name.clone()),
        "certified_at": doc.as_ref().and_then(|d| d.certified_at.clone()),
    })))
}

pub async fn get_certifier_nonce(
    State(state): State<AppState>,
    Path(wallet): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    if state.config.doc_registry_address.is_empty() {
        return Err(AppError::Internal("Registry not configured".into()));
    }

    let nonce = get_certifier_nonce_on_chain(
        &state.config.avalanche_rpc_url,
        &state.config.doc_registry_address,
        &wallet,
    )
    .await
    .map_err(|e| AppError::Internal(format!("Failed to fetch nonce: {}", e)))?;

    Ok(Json(serde_json::json!({ "nonce": nonce })))
}

pub async fn revoke_document_access(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path((doc_id, user_id)): Path<(String, String)>,
) -> AppResult<Json<serde_json::Value>> {
    let doc: Document = sqlx::query_as("SELECT * FROM documents WHERE id = ?")
        .bind(&doc_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Document not found".into()))?;

    let is_owner = if let Some(ref sid) = doc.showroom_id {
        if !sid.is_empty() {
            let showroom: Showroom = sqlx::query_as("SELECT * FROM showrooms WHERE id = ?")
                .bind(sid)
                .fetch_one(&state.pool)
                .await?;
            showroom.creator_id == claims.user_id
        } else {
            false
        }
    } else {
        let project: Project = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
            .bind(&doc.project_id)
            .fetch_one(&state.pool)
            .await?;
        project.creator_id == claims.user_id
    };

    if !is_owner {
        return Err(AppError::Forbidden("Only the owner can revoke access".into()));
    }

    sqlx::query("DELETE FROM document_access WHERE document_id = ? AND user_id = ?")
        .bind(&doc_id)
        .bind(&user_id)
        .execute(&state.pool)
        .await?;

    Ok(Json(serde_json::json!({ "revoked": true })))
}

pub async fn upload_showroom_document(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(showroom_id): Path<String>,
    mut multipart: Multipart,
) -> AppResult<Json<DocumentResponse>> {
    let showroom: Showroom = sqlx::query_as("SELECT * FROM showrooms WHERE id = ?")
        .bind(&showroom_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Showroom not found".into()))?;

    if showroom.creator_id != claims.user_id {
        return Err(AppError::Forbidden("Only the creator can upload documents".into()));
    }

    let field = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("Multipart error: {}", e)))?
        .ok_or_else(|| AppError::BadRequest("No file provided".into()))?;

    let original_name = field.file_name().unwrap_or("document").to_string();
    let mime_type = field
        .content_type()
        .unwrap_or("application/octet-stream")
        .to_string();
    let data = field
        .bytes()
        .await
        .map_err(|e| AppError::BadRequest(format!("Failed to read file: {}", e)))?;

    let file_size = data.len() as i64;
    let sha256_hash = compute_sha256(&data);

    let (ciphertext, key_b64, iv_b64) =
        encrypt_document(&data).map_err(|e| AppError::Internal(e.to_string()))?;

    let doc_id = uuid::Uuid::new_v4().to_string();
    let stored_filename = doc_id.clone();
    let stored_path = format!("{}/{}", state.config.document_storage_path, stored_filename);

    let canonical_base = std::path::Path::new(&state.config.document_storage_path)
        .canonicalize()
        .map_err(|e| AppError::Internal(format!("Failed to resolve storage path: {}", e)))?;
    let parent = std::path::Path::new(&stored_path).parent()
        .ok_or_else(|| AppError::Internal("Invalid storage path".into()))?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| AppError::Internal(format!("Failed to resolve file path: {}", e)))?;
    if !canonical_parent.starts_with(&canonical_base) {
        return Err(AppError::Forbidden("Invalid document path".into()));
    }

    tokio::fs::write(&stored_path, &ciphertext)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to write file: {}", e)))?;

    let sanitized_name = original_name
        .replace(['/', '\\', '\0', '\r', '\n'], "_")
        .trim_start_matches('.')
        .to_string();
    let sanitized_name = if sanitized_name.is_empty() { "document".to_string() } else { sanitized_name };

    sqlx::query(
        "INSERT INTO documents (id, project_id, showroom_id, uploader_id, original_name, mime_type, file_size, stored_path, sha256_hash, encryption_key, encryption_iv)
         VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&doc_id)
    .bind(&showroom_id)
    .bind(&claims.user_id)
    .bind(&sanitized_name)
    .bind(&mime_type)
    .bind(file_size)
    .bind(&stored_filename)
    .bind(&sha256_hash)
    .bind(&key_b64)
    .bind(&iv_b64)
    .execute(&state.pool)
    .await?;

    let doc: Document = sqlx::query_as("SELECT * FROM documents WHERE id = ?")
        .bind(&doc_id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(DocumentResponse::from(doc)))
}

pub async fn list_showroom_documents(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(showroom_id): Path<String>,
) -> AppResult<Json<Vec<DocumentResponse>>> {
    let showroom: Showroom = sqlx::query_as("SELECT * FROM showrooms WHERE id = ?")
        .bind(&showroom_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Showroom not found".into()))?;

    let docs: Vec<Document> = if showroom.creator_id == claims.user_id {
        sqlx::query_as("SELECT * FROM documents WHERE showroom_id = ? ORDER BY created_at DESC LIMIT 200")
            .bind(&showroom_id)
            .fetch_all(&state.pool)
            .await?
    } else {
        // Check if user is an accepted participant
        let participant: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM showroom_participants WHERE showroom_id = ? AND user_id = ? AND status = 'accepted'"
        )
        .bind(&showroom_id)
        .bind(&claims.user_id)
        .fetch_optional(&state.pool)
        .await?;

        if participant.is_none() {
            return Err(AppError::Forbidden("No access to this showroom".into()));
        }

        sqlx::query_as(
            "SELECT d.* FROM documents d
             INNER JOIN document_access da ON da.document_id = d.id
             WHERE d.showroom_id = ? AND da.user_id = ?
             ORDER BY d.created_at DESC LIMIT 200",
        )
        .bind(&showroom_id)
        .bind(&claims.user_id)
        .fetch_all(&state.pool)
        .await?
    };

    let mut responses: Vec<DocumentResponse> = Vec::new();
    for doc in docs {
        let mut resp = DocumentResponse::from(doc.clone());
        if resp.certified_at.is_some() {
            let earliest: Option<Document> = sqlx::query_as(
                "SELECT * FROM documents WHERE sha256_hash = ? AND tx_hash IS NOT NULL AND tx_hash != '' ORDER BY certified_at ASC LIMIT 1",
            )
            .bind(&doc.sha256_hash)
            .fetch_optional(&state.pool)
            .await?;

            if let Some(ref orig) = earliest {
                if resp.tx_hash.as_ref().map_or(true, |h| h.is_empty()) {
                    resp.tx_hash = orig.tx_hash.clone();
                }
                if orig.id != doc.id {
                    let proj: Option<Project> = sqlx::query_as("SELECT * FROM projects WHERE id = ?")
                        .bind(&orig.project_id)
                        .fetch_optional(&state.pool)
                        .await?;
                    resp.original_project_id = Some(orig.project_id.clone());
                    resp.original_project_name = proj.map(|p| p.name);
                    resp.original_certified_by = orig.certified_by.clone();
                }
            }

            if resp.tx_hash.as_ref().map_or(true, |h| h.is_empty()) {
                resp.certified_at = None;
            }
        }
        responses.push(resp);
    }
    Ok(Json(responses))
}
