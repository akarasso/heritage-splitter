use std::sync::Arc;

use axum::Router;
use axum::http::HeaderValue;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use tokio::sync::broadcast;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;
use tower_http::request_id::{SetRequestIdLayer, PropagateRequestIdLayer, MakeRequestUuid};

use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use heritage_backend::config::Config;
use heritage_backend::models;
use heritage_backend::routes;
use heritage_backend::services::notifications::WsEvent;
use heritage_backend::{db, AppState, RateLimiter, build_router};

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
        models::Collection,
        models::CreateCollection,
        models::UpdateCollection,
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
        (name = "Collections", description = "NFT collection management"),
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
        .create_if_missing(true)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(20)
        .connect_with(connect_options)
        .await?;

    db::run_migrations(&pool).await?;
    tracing::info!("Database migrations complete");

    let (tx, _rx) = broadcast::channel::<WsEvent>(256);
    // Ensure document storage directory exists
    std::fs::create_dir_all(&config.document_storage_path).ok();

    let rate_limiter = RateLimiter::default();

    // Background task to clean expired nonces + rate limiter entries every 5 minutes
    let cleanup_pool = pool.clone();
    let cleanup_rate_limiter = rate_limiter.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
        loop {
            interval.tick().await;
            let _ = sqlx::query("DELETE FROM auth_nonces WHERE created_at < datetime('now', '-15 minutes')")
                .execute(&cleanup_pool)
                .await;
            cleanup_rate_limiter.cleanup(std::time::Duration::from_secs(300));
        }
    });

    // Initialize MinIO storage (optional — gracefully degrades if unavailable)
    let storage = if !config.minio_endpoint.is_empty() {
        match heritage_backend::services::storage::ImageStorage::new(
            &config.minio_endpoint,
            &config.minio_access_key,
            &config.minio_secret_key,
            &config.minio_bucket,
        ).await {
            Ok(s) => {
                tracing::info!("MinIO storage initialized at {}", config.minio_endpoint);
                Some(Arc::new(s))
            }
            Err(e) => {
                tracing::warn!("MinIO storage unavailable ({}), image uploads disabled", e);
                None
            }
        }
    } else {
        None
    };

    let addr = format!("{}:{}", config.host, config.port);

    let rate_limit_per_min: u32 = std::env::var("RATE_LIMIT_PER_MIN")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(60);
    let ws_rate_limit_per_min: u32 = std::env::var("WS_RATE_LIMIT_PER_MIN")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(5);

    let state = AppState {
        pool,
        notifier: Arc::new(tx),
        config,
        rate_limiter,
        rate_limit_per_min,
        ws_rate_limit_per_min,
        storage,
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

    let mut app = Router::new();
    if state.config.environment != "production" {
        app = app.merge(SwaggerUi::new("/api/docs").url("/api/docs/openapi.json", ApiDoc::openapi()));
    }
    let app = app
        .merge(build_router(state))
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
        .layer(SetResponseHeaderLayer::overriding(
            axum::http::header::STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static("max-age=31536000; includeSubDomains"),
        ));

    tracing::info!("Starting server on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
