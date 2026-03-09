pub mod config;
pub mod db;
pub mod error;
pub mod middleware;
pub mod models;
pub mod routes;
pub mod services;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::{
    extract::DefaultBodyLimit,
    middleware as axum_middleware,
    routing::{delete, get, post, put},
    Router,
};
use sqlx::SqlitePool;
use tokio::sync::broadcast;

use crate::config::Config;
use crate::services::notifications::WsEvent;
use crate::services::storage::ImageStorage;

/// Simple in-memory rate limiter: maps IP → (count, window_start)
#[derive(Clone, Default)]
pub struct RateLimiter {
    pub requests: Arc<Mutex<HashMap<String, (u32, std::time::Instant)>>>,
}

impl RateLimiter {
    /// Check if request is allowed. Returns true if within limit.
    /// `max_requests` per `window` duration.
    pub fn check(&self, key: &str, max_requests: u32, window: std::time::Duration) -> bool {
        let mut map = self.requests.lock().unwrap();
        let now = std::time::Instant::now();
        let entry = map.entry(key.to_string()).or_insert((0, now));
        if now.duration_since(entry.1) > window {
            *entry = (1, now);
            true
        } else if entry.0 < max_requests {
            entry.0 += 1;
            true
        } else {
            false
        }
    }

    /// Remove entries whose window has expired (older than max_age).
    pub fn cleanup(&self, max_age: std::time::Duration) {
        let mut map = self.requests.lock().unwrap();
        let now = std::time::Instant::now();
        map.retain(|_, (_, started)| now.duration_since(*started) <= max_age);
    }
}

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub notifier: Arc<broadcast::Sender<WsEvent>>,
    pub config: Config,
    pub rate_limiter: RateLimiter,
    pub rate_limit_per_min: u32,
    pub ws_rate_limit_per_min: u32,
    pub storage: Option<Arc<ImageStorage>>,
}

/// Build the full Axum router with the given state.
pub fn build_router(state: AppState) -> Router {
    // Public routes (no auth)
    let public_routes = Router::new()
        .route("/api/health", get(routes::health::health_check))
        .route("/api/ready", get(routes::health::readiness_check))
        .route("/api/auth/nonce", post(routes::auth::get_nonce))
        .route("/api/auth/verify", post(routes::auth::verify))
        .route("/api/auth/logout", post(routes::auth::logout))
        .route(
            "/api/public/verify/{contract}/{tokenId}",
            get(routes::public::verify_nft),
        )
        .route(
            "/api/public/projects",
            get(routes::public::list_public_projects),
        )
        .route(
            "/api/public/projects/{id}",
            get(routes::public::get_public_project),
        )
        .route(
            "/api/public/collections/{slug}",
            get(routes::public::get_public_collection),
        )
        .route(
            "/api/metadata/{contract}/{tokenId}",
            get(routes::public::nft_metadata),
        )
        .route(
            "/api/images/nft/{nftId}",
            get(routes::public::nft_image),
        )
        .route(
            "/api/public/collections/{collectionId}/history",
            get(routes::public::collection_history),
        )
        .route(
            "/api/public/showrooms/{slug}",
            get(routes::public::get_public_showroom),
        )
        .route(
            "/api/public/verify-document/{sha256_hash}",
            get(routes::documents::verify_document),
        )
        .route(
            "/api/documents/nonce/{wallet}",
            get(routes::documents::get_certifier_nonce),
        )
        .route("/api/ws", get(routes::ws::ws_handler))
        .route(
            "/api/images/avatar/{userId}",
            get(routes::images::avatar_image),
        )
        .route(
            "/api/images/logo/{projectId}",
            get(routes::images::logo_image),
        )
        .route(
            "/api/images/storage/{*key}",
            get(routes::images::storage_image),
        );

    // Protected routes (require JWT)
    let protected_routes = Router::new()
        .route("/api/me", get(routes::users::get_me).put(routes::users::update_me))
        .route("/api/users", get(routes::users::list_users))
        .route(
            "/api/users/{wallet}",
            get(routes::users::get_user_by_wallet),
        )
        .route(
            "/api/projects",
            post(routes::projects::create_project).get(routes::projects::list_my_projects),
        )
        .route(
            "/api/projects/{id}",
            get(routes::projects::get_project).put(routes::projects::update_project),
        )
        .route(
            "/api/projects/{id}/close",
            post(routes::projects::close_project),
        )
        .route(
            "/api/projects/{id}/reopen",
            post(routes::projects::reopen_project),
        )
        .route(
            "/api/projects/{id}/submit-for-approval",
            post(routes::projects::submit_for_approval),
        )
        .route(
            "/api/projects/{id}/approve-terms",
            post(routes::projects::approve_terms),
        )
        .route(
            "/api/projects/{id}/participants",
            post(routes::participants::add_participant),
        )
        .route(
            "/api/participants/{id}/accept",
            put(routes::participants::accept_invitation),
        )
        .route(
            "/api/participants/{id}/reject",
            put(routes::participants::reject_invitation),
        )
        .route(
            "/api/participants/{id}",
            put(routes::participants::update_participant),
        )
        .route(
            "/api/participants/{id}/kick",
            put(routes::participants::kick_participant),
        )
        .route(
            "/api/projects/{id}/allocations",
            post(routes::allocations::create_allocation).get(routes::allocations::list_allocations),
        )
        .route(
            "/api/allocations/{id}",
            put(routes::allocations::update_allocation).delete(routes::allocations::delete_allocation),
        )
        .route(
            "/api/allocations/{id}/recompute",
            post(routes::allocations::recompute_shares),
        )
        // Collections
        .route(
            "/api/projects/{id}/collections",
            post(routes::collections::create_collection).get(routes::collections::list_collections),
        )
        .route(
            "/api/collections/{id}",
            get(routes::collections::get_collection).put(routes::collections::update_collection).delete(routes::collections::delete_collection),
        )
        .route(
            "/api/collections/{id}/submit-for-approval",
            post(routes::collections::submit_collection_for_approval),
        )
        .route(
            "/api/collections/{id}/deploy",
            post(routes::collections::deploy_collection),
        )
        .route(
            "/api/collections/{id}/approve",
            post(routes::collections::approve_collection_terms),
        )
        .route(
            "/api/collections/{id}/validate-approval",
            post(routes::collections::validate_approval),
        )
        .route(
            "/api/collections/{id}/allocations",
            post(routes::collections::create_collection_allocation),
        )
        .route(
            "/api/collections/{id}/mint",
            post(routes::collections::mint_collection_nft),
        )
        .route(
            "/api/collections/{id}/nfts",
            get(routes::collections::list_collection_nfts),
        )
        .route(
            "/api/collections/{id}/nfts/{token_id}/delist",
            post(routes::collections::delist_collection_nft),
        )
        .route(
            "/api/collections/{id}/nfts/{token_id}/relist",
            post(routes::collections::relist_collection_nft),
        )
        .route(
            "/api/collections/{id}/draft-nfts",
            get(routes::collections::list_draft_nfts),
        )
        .route(
            "/api/draft-nfts/{id}",
            delete(routes::collections::delete_draft_nft),
        )
        .route(
            "/api/collections/{id}/submit-for-mint-approval",
            post(routes::collections::submit_for_mint_approval),
        )
        .route(
            "/api/collections/{id}/publish",
            post(routes::collections::publish_collection),
        )
        .route(
            "/api/collections/{id}/unpublish",
            post(routes::collections::unpublish_collection),
        )
        .route(
            "/api/collections/{id}/contracts",
            put(routes::collections::update_contracts),
        )
        .route(
            "/api/projects/{id}/threads",
            get(routes::messages::list_threads).post(routes::messages::create_thread),
        )
        .route(
            "/api/threads/{id}/messages",
            get(routes::messages::list_messages).post(routes::messages::create_message),
        )
        .route(
            "/api/threads/{id}/resolve",
            put(routes::messages::resolve_thread),
        )
        .route(
            "/api/threads/{id}/reopen",
            put(routes::messages::reopen_thread),
        )
        // Direct messages
        .route("/api/dm/conversations", get(routes::direct_messages::list_conversations))
        .route("/api/dm/{user_id}", get(routes::direct_messages::get_conversation).post(routes::direct_messages::send_message))
        // Notifications
        .route("/api/notifications", get(routes::notifications::list_notifications))
        .route("/api/notifications/unread-count", get(routes::notifications::unread_count))
        .route("/api/notifications/{id}/read", put(routes::notifications::mark_read))
        .route("/api/notifications/read-all", put(routes::notifications::mark_all_read))
        .route("/api/projects/{id}/activity", get(routes::notifications::get_project_activity))
        // Documents (non-upload)
        .route(
            "/api/projects/{id}/documents",
            get(routes::documents::list_documents),
        )
        .route(
            "/api/documents/{id}/download",
            get(routes::documents::download_document),
        )
        .route(
            "/api/documents/{id}/certify",
            post(routes::documents::certify_document),
        )
        .route(
            "/api/documents/{id}/share",
            post(routes::documents::share_document),
        )
        .route(
            "/api/documents/{id}/share/{user_id}",
            delete(routes::documents::revoke_document_access),
        )
        // Showrooms
        .route(
            "/api/showrooms",
            post(routes::showrooms::create_showroom).get(routes::showrooms::list_showrooms),
        )
        .route(
            "/api/showrooms/{id}",
            get(routes::showrooms::get_showroom).put(routes::showrooms::update_showroom),
        )
        .route(
            "/api/showrooms/{id}/invite",
            post(routes::showrooms::invite_to_showroom),
        )
        .route(
            "/api/showrooms/{id}/accept",
            post(routes::showrooms::accept_showroom_invite),
        )
        .route(
            "/api/showrooms/{id}/participants/{user_id}",
            delete(routes::showrooms::remove_showroom_participant),
        )
        .route(
            "/api/showrooms/{id}/listings",
            post(routes::showrooms::create_showroom_listing),
        )
        .route(
            "/api/showroom-listings/{id}",
            put(routes::showrooms::update_showroom_listing).delete(routes::showrooms::delete_showroom_listing),
        )
        .route(
            "/api/showrooms/{id}/deploy",
            post(routes::showrooms::deploy_showroom),
        )
        .route(
            "/api/showrooms/{id}/publish",
            post(routes::showrooms::publish_showroom),
        )
        .route(
            "/api/showrooms/{id}/unpublish",
            post(routes::showrooms::unpublish_showroom),
        )
        .route(
            "/api/showrooms/{id}/propose-collection",
            post(routes::showrooms::propose_collection),
        )
        .route(
            "/api/showrooms/{id}/my-collections",
            get(routes::showrooms::list_proposable_collections),
        )
        .route(
            "/api/showrooms/{id}/batch-margin",
            put(routes::showrooms::batch_update_margin),
        )
        .route(
            "/api/showrooms/{id}/collections/{collection_id}",
            delete(routes::showrooms::unshare_collection),
        )
        // Showroom documents (list only; upload via upload_routes)
        .route(
            "/api/showrooms/{id}/documents",
            get(routes::documents::list_showroom_documents),
        )
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        .layer(axum_middleware::from_fn_with_state(state.clone(), middleware::rate_limit_middleware))
        .layer(axum_middleware::from_fn_with_state(state.clone(), middleware::auth_middleware));

    // Document/image upload routes with larger body limit (50MB)
    let upload_routes = Router::new()
        .route(
            "/api/projects/{id}/documents",
            post(routes::documents::upload_document),
        )
        .route(
            "/api/showrooms/{id}/documents",
            post(routes::documents::upload_showroom_document),
        )
        .route(
            "/api/images/upload",
            post(routes::images::upload_image),
        )
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024))
        .layer(axum_middleware::from_fn_with_state(state.clone(), middleware::rate_limit_middleware))
        .layer(axum_middleware::from_fn_with_state(state.clone(), middleware::auth_middleware));

    // Draft NFT create/update routes with larger body limit (50MB) for image data
    let draft_nft_routes = Router::new()
        .route(
            "/api/collections/{id}/draft-nfts",
            post(routes::collections::create_draft_nft),
        )
        .route(
            "/api/draft-nfts/{id}",
            put(routes::collections::update_draft_nft),
        )
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024))
        .layer(axum_middleware::from_fn_with_state(state.clone(), middleware::rate_limit_middleware))
        .layer(axum_middleware::from_fn_with_state(state.clone(), middleware::auth_middleware));

    Router::new()
        .merge(public_routes)
        .merge(upload_routes)
        .merge(draft_nft_routes)
        .merge(protected_routes)
        .with_state(state)
}
