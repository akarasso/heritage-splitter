use std::sync::Arc;

use axum::body::Body;
use axum::http::{self, Request, StatusCode};
use http_body_util::BodyExt;
use jsonwebtoken::{encode, EncodingKey, Header};
use serde_json::{json, Value};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use tokio::sync::broadcast;
use tower::ServiceExt;

use heritage_backend::config::Config;
use heritage_backend::middleware::Claims;
use heritage_backend::services::notifications::WsEvent;
use heritage_backend::{build_router, db, AppState, RateLimiter};

const JWT_SECRET: &str = "test-secret-key-for-tests";
const USER1_WALLET: &str = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const USER1_ID: &str = "user1-test-id";
const USER2_WALLET: &str = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

fn test_config() -> Config {
    Config {
        database_url: String::new(), // unused since pool is created directly
        jwt_secret: JWT_SECRET.into(),
        avalanche_rpc_url: String::new(),
        factory_address: String::new(),
        market_address: String::new(),
        chain_id: 43113,
        host: "127.0.0.1".into(),
        port: 0,
        document_storage_path: "/tmp/heritage-test-docs".into(),
        certifier_private_key: String::new(),
        doc_registry_address: String::new(),
        registry_address: String::new(),
        base_url: "http://localhost".into(),
        bot_delay_secs: 0,
        cookie_domain: None,
        secure_cookies: false,
        environment: "test".into(),
        minio_endpoint: String::new(),
        minio_access_key: String::new(),
        minio_secret_key: String::new(),
        minio_bucket: String::new(),
    }
}

fn make_jwt(wallet: &str, user_id: &str) -> String {
    let claims = Claims {
        sub: wallet.to_string(),
        user_id: user_id.to_string(),
        exp: (chrono::Utc::now().timestamp() + 86400) as usize,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(JWT_SECRET.as_bytes()),
    )
    .expect("JWT encoding must succeed")
}

async fn setup() -> (axum::Router, sqlx::SqlitePool) {
    // Disable foreign_keys to match production behavior (the app stores wallet addresses
    // as creator_id even though the column references users(id)).
    // Use a unique temp file per test to avoid cross-test interference.
    let db_path = format!(
        "/tmp/heritage-test-{}-{}.db",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let opts = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .foreign_keys(false);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(opts)
        .await
        .expect("temp SQLite");

    db::run_migrations(&pool).await.expect("migrations");

    // Insert test users (bypass seed data which may already exist)
    sqlx::query(
        "INSERT OR IGNORE INTO users (id, wallet_address, display_name, role, bio, avatar_url, artist_number, is_bot)
         VALUES (?, ?, 'Test User 1', 'artist', '', '', '', 0)"
    )
    .bind(USER1_ID)
    .bind(USER1_WALLET)
    .execute(&pool)
    .await
    .expect("insert user1");

    // User2: we use their wallet as their ID so the accept-invite flow works
    // (the showroom accept handler matches user_id = claims.sub = wallet)
    sqlx::query(
        "INSERT OR IGNORE INTO users (id, wallet_address, display_name, role, bio, avatar_url, artist_number, is_bot)
         VALUES (?, ?, 'Test User 2', 'gallery', '', '', '', 0)"
    )
    .bind(USER2_WALLET)
    .bind(USER2_WALLET)
    .execute(&pool)
    .await
    .expect("insert user2");

    let (tx, _rx) = broadcast::channel::<WsEvent>(64);
    let state = AppState {
        pool: pool.clone(),
        notifier: Arc::new(tx),
        config: test_config(),
        rate_limiter: RateLimiter::default(),
        storage: None,
        rate_limit_per_min: 60,
        ws_rate_limit_per_min: 5,
    };

    let router = build_router(state);
    (router, pool)
}

/// Helper to read the response body as JSON.
async fn body_json(resp: axum::response::Response) -> Value {
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap_or_else(|_| {
        let text = String::from_utf8_lossy(&bytes);
        panic!("Response is not valid JSON: {}", text);
    })
}

// ─────────────────────────────── Auth checks ────────────────────────────────

#[tokio::test]
async fn test_showroom_endpoints_require_auth() {
    let (app, _pool) = setup().await;

    // POST /api/showrooms without token -> 401
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri("/api/showrooms")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"name":"test"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    // GET /api/showrooms without token -> 401
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/showrooms")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

// ─────────────────────── POST /api/showrooms ────────────────────────────────

#[tokio::test]
async fn test_create_showroom() {
    let (app, _pool) = setup().await;
    let token = make_jwt(USER1_WALLET, USER1_ID);

    let resp = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri("/api/showrooms")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::from(
                    json!({
                        "name": "My Showroom",
                        "description": "A test showroom"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    let status = resp.status();
    let body = body_json(resp).await;
    assert_eq!(status, StatusCode::OK, "body: {}", body);
    assert_eq!(body["name"], "My Showroom");
    assert_eq!(body["description"], "A test showroom");
    assert_eq!(body["status"], "draft");
    assert_eq!(body["creator_id"], USER1_ID);
    assert!(body["id"].as_str().is_some());
}

// ─────────────────── GET /api/showrooms (list) ──────────────────────────────

#[tokio::test]
async fn test_list_showrooms_empty() {
    let (app, _pool) = setup().await;
    let token = make_jwt(USER1_WALLET, USER1_ID);

    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/showrooms")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    let arr = body.as_array().expect("should be array");
    assert!(arr.is_empty());
}

#[tokio::test]
async fn test_list_showrooms_with_data() {
    let (app, _pool) = setup().await;
    let token = make_jwt(USER1_WALLET, USER1_ID);

    // Create a showroom first
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri("/api/showrooms")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::from(json!({"name": "S1"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // List
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/showrooms")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    let arr = body.as_array().expect("should be array");
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["name"], "S1");
}

// ─────────────────── GET /api/showrooms/{id} ────────────────────────────────

#[tokio::test]
async fn test_get_showroom_detail() {
    let (app, _pool) = setup().await;
    let token = make_jwt(USER1_WALLET, USER1_ID);

    // Create
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri("/api/showrooms")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::from(
                    json!({"name": "Detail Test", "description": "desc"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let created = body_json(resp).await;
    let id = created["id"].as_str().unwrap();

    // Get detail
    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/showrooms/{}", id))
                .header("authorization", format!("Bearer {}", token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["name"], "Detail Test");
    assert_eq!(body["description"], "desc");
    assert!(body["participants"].as_array().unwrap().is_empty());
    assert!(body["listings"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn test_get_showroom_not_found() {
    let (app, _pool) = setup().await;
    let token = make_jwt(USER1_WALLET, USER1_ID);

    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/showrooms/nonexistent-id")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

// ─────────────────── PUT /api/showrooms/{id} ────────────────────────────────

#[tokio::test]
async fn test_update_showroom() {
    let (app, _pool) = setup().await;
    let token = make_jwt(USER1_WALLET, USER1_ID);

    // Create
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri("/api/showrooms")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::from(json!({"name": "Before"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let created = body_json(resp).await;
    let id = created["id"].as_str().unwrap();

    // Update
    let resp = app
        .oneshot(
            Request::builder()
                .method(http::Method::PUT)
                .uri(format!("/api/showrooms/{}", id))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::from(
                    json!({"name": "After", "description": "updated desc"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["name"], "After");
    assert_eq!(body["description"], "updated desc");
}

#[tokio::test]
async fn test_update_showroom_forbidden_for_non_owner() {
    let (app, _pool) = setup().await;
    let token1 = make_jwt(USER1_WALLET, USER1_ID);
    let token2 = make_jwt(USER2_WALLET, USER2_WALLET);

    // User1 creates
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri("/api/showrooms")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token1))
                .body(Body::from(json!({"name": "Owner only"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let created = body_json(resp).await;
    let id = created["id"].as_str().unwrap();

    // User2 tries to update -> forbidden
    let resp = app
        .oneshot(
            Request::builder()
                .method(http::Method::PUT)
                .uri(format!("/api/showrooms/{}", id))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token2))
                .body(Body::from(json!({"name": "Hacked"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

// ─────────── POST /api/showrooms/{id}/invite ────────────────────────────────

#[tokio::test]
async fn test_invite_user_to_showroom() {
    let (app, _pool) = setup().await;
    let token = make_jwt(USER1_WALLET, USER1_ID);

    // Create showroom
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri("/api/showrooms")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::from(json!({"name": "Invite Test"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let created = body_json(resp).await;
    let showroom_id = created["id"].as_str().unwrap();

    // Invite user2 (user2 id = USER2_WALLET in our test setup)
    let resp = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/api/showrooms/{}/invite", showroom_id))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::from(
                    json!({"user_id": USER2_WALLET}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["showroom_id"], showroom_id);
    assert_eq!(body["user_id"], USER2_WALLET);
    assert_eq!(body["status"], "accepted");
}

#[tokio::test]
async fn test_invite_nonexistent_user() {
    let (app, _pool) = setup().await;
    let token = make_jwt(USER1_WALLET, USER1_ID);

    // Create showroom
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri("/api/showrooms")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::from(json!({"name": "Inv Test"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let created = body_json(resp).await;
    let id = created["id"].as_str().unwrap();

    // Invite non-existent user -> 404
    let resp = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/api/showrooms/{}/invite", id))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::from(
                    json!({"user_id": "no-such-user"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

// ─────────── POST /api/showrooms/{id}/accept ────────────────────────────────

#[tokio::test]
async fn test_accept_showroom_invite() {
    let (app, _pool) = setup().await;
    let token1 = make_jwt(USER1_WALLET, USER1_ID);
    // User2's claims.sub = USER2_WALLET, must match the invited user_id
    let token2 = make_jwt(USER2_WALLET, USER2_WALLET);

    // Create showroom
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri("/api/showrooms")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token1))
                .body(Body::from(json!({"name": "Accept Test"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let created = body_json(resp).await;
    let showroom_id = created["id"].as_str().unwrap();

    // Invite user2
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/api/showrooms/{}/invite", showroom_id))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token1))
                .body(Body::from(
                    json!({"user_id": USER2_WALLET}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Showroom invites are auto-accepted, so trying to accept again returns 400
    let resp = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/api/showrooms/{}/accept", showroom_id))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token2))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_accept_without_invitation() {
    let (app, _pool) = setup().await;
    let token1 = make_jwt(USER1_WALLET, USER1_ID);
    let token2 = make_jwt(USER2_WALLET, USER2_WALLET);

    // Create showroom
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri("/api/showrooms")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token1))
                .body(Body::from(json!({"name": "No Invite"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let created = body_json(resp).await;
    let id = created["id"].as_str().unwrap();

    // User2 tries to accept without being invited -> 404
    let resp = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/api/showrooms/{}/accept", id))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token2))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

// ──────── POST /api/showrooms/{id}/listings ─────────────────────────────────

#[tokio::test]
async fn test_create_listing() {
    let (app, _pool) = setup().await;
    let token = make_jwt(USER1_WALLET, USER1_ID);

    // Create showroom
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri("/api/showrooms")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::from(json!({"name": "Listing Test"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let created = body_json(resp).await;
    let showroom_id = created["id"].as_str().unwrap();

    // Create listing
    let resp = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/api/showrooms/{}/listings", showroom_id))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::from(
                    json!({
                        "nft_contract": "0x1234567890123456789012345678901234567890",
                        "token_id": 1,
                        "base_price": "1000000000000000000"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["showroom_id"], showroom_id);
    assert_eq!(body["token_id"], 1);
    assert_eq!(body["base_price"], "1000000000000000000");
    assert_eq!(body["margin"], "0");
    assert_eq!(body["status"], "proposed");
    assert_eq!(body["proposed_by"], USER1_ID);
}

#[tokio::test]
async fn test_create_listing_by_accepted_participant() {
    let (app, _pool) = setup().await;
    let token1 = make_jwt(USER1_WALLET, USER1_ID);
    let token2 = make_jwt(USER2_WALLET, USER2_WALLET);

    // Create showroom
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri("/api/showrooms")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token1))
                .body(Body::from(json!({"name": "Participant Listing"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let created = body_json(resp).await;
    let showroom_id = created["id"].as_str().unwrap();

    // Invite and accept user2
    app.clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/api/showrooms/{}/invite", showroom_id))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token1))
                .body(Body::from(json!({"user_id": USER2_WALLET}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    app.clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/api/showrooms/{}/accept", showroom_id))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token2))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    // User2 (accepted participant) creates a listing
    let resp = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/api/showrooms/{}/listings", showroom_id))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token2))
                .body(Body::from(
                    json!({
                        "nft_contract": "0xabcdef1234567890abcdef1234567890abcdef12",
                        "token_id": 42,
                        "base_price": "500"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["proposed_by"], USER2_WALLET);
    assert_eq!(body["token_id"], 42);
}

#[tokio::test]
async fn test_create_listing_forbidden_for_uninvited() {
    let (app, _pool) = setup().await;
    let token1 = make_jwt(USER1_WALLET, USER1_ID);
    let token2 = make_jwt(USER2_WALLET, USER2_WALLET);

    // Create showroom (user1 only)
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri("/api/showrooms")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token1))
                .body(Body::from(json!({"name": "No Access"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let created = body_json(resp).await;
    let id = created["id"].as_str().unwrap();

    // User2 (not invited) tries to create listing -> forbidden
    let resp = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/api/showrooms/{}/listings", id))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token2))
                .body(Body::from(
                    json!({"nft_contract": "0x0000000000000000000000000000000000000000", "token_id": 1}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

// ──────── PUT /api/showroom-listings/{id} ───────────────────────────────────

#[tokio::test]
async fn test_update_listing_set_margin() {
    let (app, _pool) = setup().await;
    let token = make_jwt(USER1_WALLET, USER1_ID);

    // Create showroom + listing
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri("/api/showrooms")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::from(json!({"name": "Margin Test"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let showroom = body_json(resp).await;
    let showroom_id = showroom["id"].as_str().unwrap();

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/api/showrooms/{}/listings", showroom_id))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::from(
                    json!({"nft_contract": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabc", "token_id": 5, "base_price": "100"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let listing = body_json(resp).await;
    let listing_id = listing["id"].as_str().unwrap();

    // Update listing margin
    let resp = app
        .oneshot(
            Request::builder()
                .method(http::Method::PUT)
                .uri(format!("/api/showroom-listings/{}", listing_id))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::from(
                    json!({"margin": "15", "status": "approved"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["margin"], "15");
    assert_eq!(body["status"], "approved");
}

// ──────── DELETE /api/showroom-listings/{id} ────────────────────────────────

#[tokio::test]
async fn test_delete_listing() {
    let (app, _pool) = setup().await;
    let token = make_jwt(USER1_WALLET, USER1_ID);

    // Create showroom + listing
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri("/api/showrooms")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::from(json!({"name": "Delete Test"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let showroom = body_json(resp).await;
    let showroom_id = showroom["id"].as_str().unwrap();

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/api/showrooms/{}/listings", showroom_id))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::from(
                    json!({"nft_contract": "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead", "token_id": 7}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let listing = body_json(resp).await;
    let listing_id = listing["id"].as_str().unwrap();

    // Delete listing
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/api/showroom-listings/{}", listing_id))
                .header("authorization", format!("Bearer {}", token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["deleted"], true);

    // Verify listing is gone via showroom detail
    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/showrooms/{}", showroom_id))
                .header("authorization", format!("Bearer {}", token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let detail = body_json(resp).await;
    assert!(detail["listings"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn test_delete_listing_forbidden_for_non_owner_non_proposer() {
    let (app, _pool) = setup().await;
    let token1 = make_jwt(USER1_WALLET, USER1_ID);
    let token2 = make_jwt(USER2_WALLET, USER2_WALLET);

    // User1 creates showroom + listing
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri("/api/showrooms")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token1))
                .body(Body::from(json!({"name": "Forbid Delete"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let showroom = body_json(resp).await;
    let showroom_id = showroom["id"].as_str().unwrap();

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/api/showrooms/{}/listings", showroom_id))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token1))
                .body(Body::from(
                    json!({"nft_contract": "0xbeefbeefbeefbeefbeefbeefbeefbeefbeefbeef", "token_id": 9}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let listing = body_json(resp).await;
    let listing_id = listing["id"].as_str().unwrap();

    // User2 (not owner, not proposer) tries to delete -> forbidden
    let resp = app
        .oneshot(
            Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/api/showroom-listings/{}", listing_id))
                .header("authorization", format!("Bearer {}", token2))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

// ──────── POST /api/showrooms/{id}/deploy ───────────────────────────────────

#[tokio::test]
#[ignore] // Requires blockchain RPC
async fn test_deploy_showroom() {
    let (app, _pool) = setup().await;
    let token = make_jwt(USER1_WALLET, USER1_ID);

    // Create showroom
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri("/api/showrooms")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::from(json!({"name": "Deploy Test"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let created = body_json(resp).await;
    let id = created["id"].as_str().unwrap();
    assert_eq!(created["status"], "draft");

    // Deploy
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/api/showrooms/{}/deploy", id))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["status"], "active");
}

#[tokio::test]
#[ignore] // Requires blockchain RPC
async fn test_deploy_showroom_already_deployed() {
    let (app, _pool) = setup().await;
    let token = make_jwt(USER1_WALLET, USER1_ID);

    // Create and deploy
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri("/api/showrooms")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::from(json!({"name": "Double Deploy"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let created = body_json(resp).await;
    let id = created["id"].as_str().unwrap();

    app.clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/api/showrooms/{}/deploy", id))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    // Try to deploy again -> bad request
    let resp = app
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/api/showrooms/{}/deploy", id))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
#[ignore] // Requires blockchain RPC
async fn test_update_deployed_showroom_fails() {
    let (app, _pool) = setup().await;
    let token = make_jwt(USER1_WALLET, USER1_ID);

    // Create and deploy
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri("/api/showrooms")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::from(json!({"name": "Locked"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let created = body_json(resp).await;
    let id = created["id"].as_str().unwrap();

    app.clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/api/showrooms/{}/deploy", id))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    // Try to update deployed showroom -> bad request
    let resp = app
        .oneshot(
            Request::builder()
                .method(http::Method::PUT)
                .uri(format!("/api/showrooms/{}", id))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token))
                .body(Body::from(json!({"name": "Changed"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

// ─────────────── Showroom detail includes participants and listings ─────────

#[tokio::test]
async fn test_showroom_detail_includes_participants_and_listings() {
    let (app, _pool) = setup().await;
    let token1 = make_jwt(USER1_WALLET, USER1_ID);
    let token2 = make_jwt(USER2_WALLET, USER2_WALLET);

    // Create showroom
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri("/api/showrooms")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token1))
                .body(Body::from(json!({"name": "Full Detail"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let created = body_json(resp).await;
    let showroom_id = created["id"].as_str().unwrap();

    // Invite + accept user2
    app.clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/api/showrooms/{}/invite", showroom_id))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token1))
                .body(Body::from(json!({"user_id": USER2_WALLET}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    app.clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/api/showrooms/{}/accept", showroom_id))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token2))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    // Add listing
    app.clone()
        .oneshot(
            Request::builder()
                .method(http::Method::POST)
                .uri(format!("/api/showrooms/{}/listings", showroom_id))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {}", token1))
                .body(Body::from(
                    json!({"nft_contract": "0xf00ff00ff00ff00ff00ff00ff00ff00ff00ff00f", "token_id": 10}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    // Get full detail
    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/showrooms/{}", showroom_id))
                .header("authorization", format!("Bearer {}", token1))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["participants"].as_array().unwrap().len(), 1);
    assert_eq!(body["participants"][0]["status"], "accepted");
    assert_eq!(body["participants"][0]["display_name"], "Test User 2");
    assert_eq!(body["listings"].as_array().unwrap().len(), 1);
    assert_eq!(body["listings"][0]["token_id"], 10);
}
