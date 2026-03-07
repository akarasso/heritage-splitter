use axum::{extract::State, http::StatusCode};

use crate::AppState;

#[utoipa::path(
    get,
    path = "/api/health",
    responses((status = 200, description = "Service is healthy")),
    tag = "Health"
)]
pub async fn health_check() -> StatusCode {
    StatusCode::OK
}

pub async fn readiness_check(State(state): State<AppState>) -> StatusCode {
    match sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.pool)
        .await
    {
        Ok(_) => StatusCode::OK,
        Err(_) => StatusCode::SERVICE_UNAVAILABLE,
    }
}
