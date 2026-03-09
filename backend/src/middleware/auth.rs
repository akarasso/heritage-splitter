use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use jsonwebtoken::{decode, DecodingKey, Validation, Algorithm};
use serde::{Deserialize, Serialize};

use crate::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String, // wallet address
    pub user_id: String,
    pub exp: usize,
}

pub async fn auth_middleware(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    // CSRF protection: require X-Requested-With header on state-changing requests
    // when authenticated via cookie (not Bearer token)
    let is_cookie_auth = request
        .headers()
        .get(axum::http::header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .map(|cookies| cookies.contains("heritage_session="))
        .unwrap_or(false);
    let is_state_changing = !matches!(*request.method(), axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS);

    if is_cookie_auth && is_state_changing {
        let has_csrf_header = request
            .headers()
            .get("x-requested-with")
            .is_some();
        if !has_csrf_header {
            return Err(StatusCode::FORBIDDEN);
        }
    }

    // Try cookie first, then fall back to Authorization header
    let token = request
        .headers()
        .get(axum::http::header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|cookies| {
            cookies
                .split(';')
                .map(|c| c.trim())
                .find(|c| c.starts_with("heritage_session="))
                .map(|c| c["heritage_session=".len()..].to_string())
        })
        // Fall back to Bearer token
        .or_else(|| {
            request
                .headers()
                .get(axum::http::header::AUTHORIZATION)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
                .map(|s| s.to_string())
        })
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let token_data = decode::<Claims>(
        &token,
        &DecodingKey::from_secret(state.config.jwt_secret.as_bytes()),
        &Validation::new(Algorithm::HS256),
    )
    .map_err(|_| StatusCode::UNAUTHORIZED)?;

    request.extensions_mut().insert(token_data.claims);

    Ok(next.run(request).await)
}
