mod config;
mod db;
mod error;
mod middleware;
mod models;
mod routes;
mod services;

use std::sync::Arc;

use axum::{
    extract::DefaultBodyLimit,
    middleware as axum_middleware,
    routing::{delete, get, post, put},
    Router,
};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use tokio::sync::broadcast;
use axum::http::HeaderValue;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;
use tower_http::request_id::{SetRequestIdLayer, PropagateRequestIdLayer, MakeRequestUuid};

use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use crate::config::Config;
use crate::services::notifications::WsEvent;

#[derive(OpenApi)]
#[openapi(
    info(title = "Heritage Splitter API", version = "1.0.0", description = "Backend API for Heritage Splitter"),
    paths(
        routes::auth::get_nonce,
        routes::auth::verify,
        routes::health::health_check,
    ),
    components(schemas(
        // Auth
        routes::auth::NonceRequest,
        routes::auth::NonceResponse,
        routes::auth::VerifyRequest,
        routes::auth::AuthResponse,
        // Models
        models::User,
        models::UpdateUser,
        models::Project,
        models::CreateProject,
        models::UpdateProject,
        models::Allocation,
        models::CreateAllocation,
        models::UpdateAllocation,
        models::Participant,
        models::CreateParticipant,
        models::UpdateParticipant,
        models::Work,
        models::CreateWork,
        models::UpdateWork,
        models::Nft,
        models::MintNft,
        models::DraftNft,
        models::CreateDraftNft,
        models::UpdateDraftNft,
        models::Document,
        models::DocumentResponse,
        models::DocumentAccess,
        models::ShareDocumentRequest,
        models::MessageDetail,
        models::CreateMessage,
        models::Thread,
        models::ThreadDetail,
        models::CreateThread,
        models::ResolveThread,
        models::Notification,
        models::DirectMessageDetail,
        models::CreateDirectMessage,
        // Route-level schemas
        routes::allocations::AllocationDetail,
        routes::direct_messages::PaginatedMessages,
        routes::direct_messages::Conversation,
        routes::notifications::UnreadCount,
        routes::notifications::ActivityItem,
        routes::public::PublicParticipant,
        routes::public::VerifyResponse,
        routes::public::PublicAllocation,
        routes::public::PublicProject,
        routes::public::PublicBeneficiary,
        routes::public::PublicCollectionNft,
        routes::public::PublicCollection,
    )),
    tags(
        (name = "Auth", description = "Authentication endpoints"),
        (name = "Health", description = "Health check"),
        (name = "Users", description = "User management"),
        (name = "Projects", description = "Project CRUD"),
        (name = "Allocations", description = "Allocation management"),
        (name = "Participants", description = "Participant management"),
        (name = "Works", description = "Work/NFT collection management"),
        (name = "Documents", description = "Document management"),
        (name = "Messages", description = "Project discussion"),
        (name = "DM", description = "Direct messages"),
        (name = "Notifications", description = "Notifications"),
        (name = "Public", description = "Public endpoints"),
    ),
    security(("bearer_auth" = [])),
    modifiers(&SecurityAddon)
)]
struct ApiDoc;

struct SecurityAddon;
impl utoipa::Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let components = openapi.components.get_or_insert_with(Default::default);
        components.add_security_scheme(
            "bearer_auth",
            utoipa::openapi::security::SecurityScheme::Http(
                utoipa::openapi::security::Http::new(utoipa::openapi::security::HttpAuthScheme::Bearer)
            ),
        );
    }
}

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub notifier: Arc<broadcast::Sender<WsEvent>>,
    pub config: Config,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "heritage_backend=debug,tower_http=debug".into()),
        )
        .init();

    let config = Config::from_env();

    let connect_options: SqliteConnectOptions = config.database_url.parse::<SqliteConnectOptions>()?
        .create_if_missing(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(20)
        .connect_with(connect_options)
        .await?;

    db::run_migrations(&pool).await?;
    tracing::info!("Database migrations complete");

    let (tx, _rx) = broadcast::channel::<WsEvent>(256);
    // Ensure document storage directory exists
    std::fs::create_dir_all(&config.document_storage_path).ok();

    // B2-11: Background task to clean expired nonces every 5 minutes
    let cleanup_pool = pool.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
        loop {
            interval.tick().await;
            let _ = sqlx::query("DELETE FROM auth_nonces WHERE created_at < datetime('now', '-15 minutes')")
                .execute(&cleanup_pool)
                .await;
        }
    });

    let addr = format!("{}:{}", config.host, config.port);

    let state = AppState {
        pool,
        notifier: Arc::new(tx),
        config,
    };

    let cors = {
        let allowed_origin = std::env::var("CORS_ORIGIN").unwrap_or_default();
        let origin = if allowed_origin.is_empty() {
            tracing::warn!("CORS_ORIGIN not set, defaulting to localhost origins only");
            AllowOrigin::list(
                ["http://localhost:3000", "http://localhost:8080", "http://127.0.0.1:3000", "http://127.0.0.1:8080"]
                    .iter()
                    .filter_map(|s| s.parse().ok())
            )
        } else {
            AllowOrigin::list(
                allowed_origin.split(',')
                    .filter_map(|s| s.trim().parse().ok())
            )
        };
        CorsLayer::new()
            .allow_origin(origin)
            .allow_methods([
                axum::http::Method::GET,
                axum::http::Method::POST,
                axum::http::Method::PUT,
                axum::http::Method::DELETE,
                axum::http::Method::OPTIONS,
            ])
            .allow_headers([
                axum::http::header::CONTENT_TYPE,
                axum::http::header::AUTHORIZATION,
                axum::http::header::ACCEPT,
                axum::http::header::HeaderName::from_static("x-requested-with"),
                axum::http::header::HeaderName::from_static("x-request-id"),
            ])
            .allow_credentials(true)
    };

    // Public routes (no auth)
    let public_routes = Router::new()
        .route("/api/health", get(routes::health::health_check))
        .route("/api/ready", get(routes::health::readiness_check))
        .route("/api/auth/nonce", post(routes::auth::get_nonce))
        .route("/api/auth/verify", post(routes::auth::verify))
        .route("/api/auth/logout", post(routes::auth::logout))
        .route("/api/users", get(routes::users::list_users))
        .route("/api/users/{wallet}", get(routes::users::get_user_by_wallet))
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
            "/api/public/works/{workId}/history",
            get(routes::public::work_history),
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
;

    // Protected routes (require JWT)
    let protected_routes = Router::new()
        .route("/api/me", get(routes::users::get_me).put(routes::users::update_me))
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
        // Works
        .route(
            "/api/projects/{id}/works",
            post(routes::works::create_work).get(routes::works::list_works),
        )
        .route(
            "/api/works/{id}",
            get(routes::works::get_work).put(routes::works::update_work).delete(routes::works::delete_work),
        )
        .route(
            "/api/works/{id}/submit-for-approval",
            post(routes::works::submit_work_for_approval),
        )
        .route(
            "/api/works/{id}/deploy",
            post(routes::works::deploy_work),
        )
        .route(
            "/api/works/{id}/approve",
            post(routes::works::approve_work_terms),
        )
        .route(
            "/api/works/{id}/validate-approval",
            post(routes::works::validate_approval),
        )
        .route(
            "/api/works/{id}/allocations",
            post(routes::works::create_work_allocation),
        )
        .route(
            "/api/works/{id}/mint",
            post(routes::works::mint_work_nft),
        )
        .route(
            "/api/works/{id}/nfts",
            get(routes::works::list_work_nfts),
        )
        .route(
            "/api/works/{id}/draft-nfts",
            get(routes::works::list_draft_nfts).post(routes::works::create_draft_nft),
        )
        .route(
            "/api/draft-nfts/{id}",
            put(routes::works::update_draft_nft).delete(routes::works::delete_draft_nft),
        )
        .route(
            "/api/works/{id}/submit-for-mint-approval",
            post(routes::works::submit_for_mint_approval),
        )
        .route(
            "/api/works/{id}/publish",
            post(routes::works::publish_work),
        )
        .route(
            "/api/works/{id}/unpublish",
            post(routes::works::unpublish_work),
        )
        .route(
            "/api/works/{id}/contracts",
            put(routes::works::update_contracts),
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
        // AI endpoints (require auth)
        .route("/api/ai/generate", post(routes::ai::generate))
        .route("/api/ai/generate-image", post(routes::ai::generate_image))
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024)) // 2MB default for protected routes (messages, JSON payloads)
        .layer(axum_middleware::from_fn_with_state(state.clone(), middleware::auth_middleware));

    // Document upload route with larger body limit (50MB)
    let upload_routes = Router::new()
        .route(
            "/api/projects/{id}/documents",
            post(routes::documents::upload_document),
        )
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024))
        .layer(axum_middleware::from_fn_with_state(state.clone(), middleware::auth_middleware));

    let app = Router::new()
        .merge(SwaggerUi::new("/api/docs").url("/api/docs/openapi.json", ApiDoc::openapi()))
        .merge(public_routes)
        .merge(upload_routes)
        .merge(protected_routes)
        .layer(cors)
        .layer(PropagateRequestIdLayer::x_request_id())
        .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
        .layer(TraceLayer::new_for_http()
            .make_span_with(|req: &axum::http::Request<_>| {
                let request_id = req.headers()
                    .get("x-request-id")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("unknown");
                tracing::info_span!("request", method = %req.method(), uri = %req.uri(), request_id = %request_id)
            }))
        .layer(SetResponseHeaderLayer::overriding(
            axum::http::header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            axum::http::header::X_FRAME_OPTIONS,
            HeaderValue::from_static("DENY"),
        ))
        .with_state(state);

    tracing::info!("Starting server on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
