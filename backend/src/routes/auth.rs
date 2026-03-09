use alloy::primitives::Address;
use alloy::signers::Signature;
use axum::{extract::State, response::IntoResponse, Json};
use chrono::Utc;
use jsonwebtoken::{encode, EncodingKey, Header};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

use crate::error::{AppError, AppResult};
use crate::middleware::Claims;
use crate::AppState;

#[derive(Deserialize, utoipa::ToSchema)]
pub struct NonceRequest {
    pub wallet_address: String,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct NonceResponse {
    pub nonce: String,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct VerifyRequest {
    pub wallet_address: String,
    pub signature: String,
    pub message: String,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct AuthResponse {
    pub token: String,
    pub user_exists: bool,
}

/// EIP-191 personal message hash: keccak256("\x19Ethereum Signed Message:\n" + len + message)
fn eip191_hash(message: &str) -> [u8; 32] {
    use alloy::primitives::keccak256;
    let prefix = format!("\x19Ethereum Signed Message:\n{}", message.len());
    let mut data = prefix.into_bytes();
    data.extend_from_slice(message.as_bytes());
    *keccak256(&data)
}

#[utoipa::path(
    post,
    path = "/api/auth/nonce",
    request_body = NonceRequest,
    responses((status = 200, body = NonceResponse)),
    tag = "Auth"
)]
pub async fn get_nonce(
    State(state): State<AppState>,
    Json(body): Json<NonceRequest>,
) -> AppResult<Json<NonceResponse>> {
    let wallet = body.wallet_address.to_lowercase();

    // Rate limit: 10 nonce requests per minute per wallet
    if !state.rate_limiter.check(
        &format!("nonce:{}", wallet),
        10,
        std::time::Duration::from_secs(60),
    ) {
        return Err(AppError::TooManyRequests("Too many requests, please try again later".into()));
    }
    let nonce: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();

    sqlx::query(
        "INSERT INTO auth_nonces (wallet_address, nonce, created_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(wallet_address) DO UPDATE SET nonce = excluded.nonce, created_at = CURRENT_TIMESTAMP"
    )
    .bind(&wallet)
    .bind(&nonce)
    .execute(&state.pool)
    .await?;

    Ok(Json(NonceResponse { nonce }))
}

#[utoipa::path(
    post,
    path = "/api/auth/verify",
    request_body = VerifyRequest,
    responses((status = 200, body = AuthResponse)),
    tag = "Auth"
)]
pub async fn verify(
    State(state): State<AppState>,
    Json(body): Json<VerifyRequest>,
) -> AppResult<impl IntoResponse> {
    let wallet = body.wallet_address.to_lowercase();

    // Rate limit: 5 verify attempts per minute per wallet
    if !state.rate_limiter.check(
        &format!("verify:{}", wallet),
        5,
        std::time::Duration::from_secs(60),
    ) {
        return Err(AppError::TooManyRequests("Too many attempts, please try again later".into()));
    }

    // Verify nonce exists and is not expired (15 min TTL)
    // B2-11: Nonce cleanup only runs on verify calls. This is acceptable because the 15-min TTL
    // prevents replay attacks, and the upsert in get_nonce limits to one nonce per wallet.
    // A dedicated cleanup job is unnecessary for the current scale.
    sqlx::query("DELETE FROM auth_nonces WHERE created_at < datetime('now', '-15 minutes')")
        .execute(&state.pool)
        .await?;

    let nonce_row: Option<(String,)> = sqlx::query_as(
        "SELECT nonce FROM auth_nonces WHERE wallet_address = ?"
    )
    .bind(&wallet)
    .fetch_optional(&state.pool)
    .await?;

    let nonce = nonce_row
        .ok_or_else(|| AppError::Unauthorized("No nonce found".into()))?
        .0;

    // Verify message contains the correct nonce and wallet
    let expected_message = format!(
        "Heritage Splitter Authentication\n\nWallet: {}\nNonce: {}",
        wallet, nonce
    );
    if body.message != expected_message {
        return Err(AppError::Unauthorized("Invalid message format or nonce mismatch".into()));
    }

    // Verify EIP-191 signature
    let hash = eip191_hash(&body.message);
    let sig_bytes = hex::decode(body.signature.strip_prefix("0x").unwrap_or(&body.signature))
        .map_err(|_| AppError::Unauthorized("Invalid signature hex".into()))?;

    if sig_bytes.len() != 65 {
        return Err(AppError::Unauthorized("Invalid signature length".into()));
    }

    let signature = Signature::try_from(sig_bytes.as_slice())
        .map_err(|_| AppError::Unauthorized("Invalid signature format".into()))?;

    let recovered = signature
        .recover_address_from_prehash(&hash.into())
        .map_err(|_| AppError::Unauthorized("Signature recovery failed".into()))?;

    let expected_addr = Address::from_str(&wallet)
        .map_err(|_| AppError::Unauthorized("Invalid wallet address".into()))?;

    if recovered != expected_addr {
        return Err(AppError::Unauthorized("Signature does not match wallet".into()));
    }

    // Delete used nonce
    sqlx::query("DELETE FROM auth_nonces WHERE wallet_address = ?")
        .bind(&wallet)
        .execute(&state.pool)
        .await?;

    // Check if user exists
    let user: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM users WHERE LOWER(wallet_address) = LOWER(?)"
    )
    .bind(&wallet)
    .fetch_optional(&state.pool)
    .await?;

    let (user_id, user_exists) = match user {
        Some((id,)) => (id, true),
        None => {
            // Auto-create user on first login
            let id = uuid::Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO users (id, wallet_address, display_name, role) VALUES (?, ?, '', 'artist')"
            )
            .bind(&id)
            .bind(&wallet)
            .execute(&state.pool)
            .await?;
            (id, false)
        }
    };

    // Audit log: successful authentication
    crate::services::audit::audit_log(
        &state.pool,
        &user_id,
        if user_exists { "login" } else { "register" },
        "user",
        &user_id,
        &format!("{{\"wallet\":\"{}\"}}", wallet),
    ).await;

    let claims = Claims {
        sub: wallet,
        user_id,
        exp: (Utc::now().timestamp() + 86400) as usize, // 24 hours
    };

    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(state.config.jwt_secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(e.to_string()))?;

    // Build Set-Cookie header for HttpOnly session cookie
    let mut cookie = format!(
        "heritage_session={}; HttpOnly; SameSite=Lax; Path=/api; Max-Age=86400",
        token
    );
    if state.config.secure_cookies {
        cookie.push_str("; Secure");
    }
    if let Some(ref domain) = state.config.cookie_domain {
        // B2-1: Validate cookie_domain to prevent header injection
        let sanitized: String = domain
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-')
            .collect();
        if !sanitized.is_empty() && sanitized == *domain {
            cookie.push_str(&format!("; Domain={}", sanitized));
        }
    }

    Ok((
        [(axum::http::header::SET_COOKIE, cookie)],
        Json(AuthResponse { token, user_exists }),
    ))
}

pub async fn logout() -> impl IntoResponse {
    let cookie = "heritage_session=; HttpOnly; SameSite=Lax; Path=/api; Max-Age=0";
    (
        [(axum::http::header::SET_COOKIE, cookie)],
        Json(serde_json::json!({"ok": true})),
    )
}
