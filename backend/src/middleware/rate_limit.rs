use axum::{
    extract::State,
    http::StatusCode,
    middleware::Next,
    response::Response,
    Extension,
};

use crate::middleware::Claims;
use crate::AppState;

/// Per-user rate limiter for authenticated routes.
/// Limit configurable via RATE_LIMIT_PER_MIN env var (default: 60).
pub async fn rate_limit_middleware(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    request: axum::extract::Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let key = format!("user:{}", claims.user_id);
    let limit = state.rate_limit_per_min;
    if !state.rate_limiter.check(&key, limit, std::time::Duration::from_secs(60)) {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    Ok(next.run(request).await)
}
