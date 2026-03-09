use axum::{
    extract::{State, WebSocketUpgrade, ws::{Message, WebSocket}},
    http::HeaderMap,
    response::Response,
};
use futures::{SinkExt, StreamExt};
use jsonwebtoken::{decode, DecodingKey, Validation, Algorithm};

use crate::middleware::Claims;
use crate::AppState;

pub async fn ws_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    // Rate limit WS connections by IP (configurable via WS_RATE_LIMIT_PER_MIN, default 5)
    let ip = headers.get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').last())
        .unwrap_or("anon")
        .trim()
        .to_string();
    let rate_key = format!("ws:{}", ip);
    let ws_limit = state.ws_rate_limit_per_min;
    if !state.rate_limiter.check(&rate_key, ws_limit, std::time::Duration::from_secs(60)) {
        return ws.on_upgrade(|mut socket| async move {
            let _ = socket.close().await;
        });
    }

    // Accept upgrade unconditionally — auth happens via first message
    ws.on_upgrade(move |socket| handle_auth(socket, state))
}

/// Wait for the first message to be an auth message, then start the session.
/// Close the socket if auth fails or times out (5s).
async fn handle_auth(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();

    // 5 second timeout for auth message
    let auth_result = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        async {
            while let Some(Ok(msg)) = receiver.next().await {
                if let Message::Text(text) = msg {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                        if parsed.get("type").and_then(|t| t.as_str()) == Some("auth") {
                            if let Some(token) = parsed.get("token").and_then(|t| t.as_str()) {
                                let claims = decode::<Claims>(
                                    token,
                                    &DecodingKey::from_secret(state.config.jwt_secret.as_bytes()),
                                    &Validation::new(Algorithm::HS256),
                                );
                                if let Ok(token_data) = claims {
                                    return Some(token_data.claims.user_id);
                                }
                            }
                        }
                    }
                }
                // Non-auth message or invalid — close
                return None;
            }
            None
        }
    ).await;

    let user_id = match auth_result {
        Ok(Some(uid)) => uid,
        _ => {
            let _ = sender.close().await;
            return;
        }
    };

    // Send auth_ok
    let _ = sender.send(Message::Text(
        serde_json::json!({"type": "auth_ok"}).to_string().into()
    )).await;

    // Proceed with normal socket handling
    handle_socket(sender, receiver, state, user_id).await;
}

async fn handle_socket(
    mut sender: futures::stream::SplitSink<WebSocket, Message>,
    mut receiver: futures::stream::SplitStream<WebSocket>,
    state: AppState,
    user_id: String,
) {
    let mut rx = state.notifier.subscribe();

    // Forward broadcast events to this user's websocket
    let uid = user_id.clone();
    let send_task = tokio::spawn(async move {
        while let Ok(event) = rx.recv().await {
            if event.user_id == uid {
                let json = serde_json::to_string(&serde_json::json!({
                    "kind": event.kind,
                    "payload": event.payload,
                })).unwrap_or_default();

                if sender.send(Message::Text(json.into())).await.is_err() {
                    break;
                }
            }
        }
    });

    // Consume incoming messages (keep-alive / close detection)
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(_msg)) = receiver.next().await {
            // We don't process incoming messages, just keep the connection alive
        }
    });

    // Wait for either task to finish
    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }
}
