use axum::{
    extract::{State, WebSocketUpgrade, ws::{Message, WebSocket}},
    http::HeaderMap,
    response::Response,
};
use futures::{SinkExt, StreamExt};
use jsonwebtoken::{decode, DecodingKey, Validation};

use crate::middleware::Claims;
use crate::AppState;

pub async fn ws_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    // Extract token from Sec-WebSocket-Protocol header ("bearer, <token>")
    let token = headers
        .get("sec-websocket-protocol")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| {
            let parts: Vec<&str> = v.split(',').map(|s| s.trim()).collect();
            if parts.len() >= 2 && parts[0] == "bearer" {
                Some(parts[1].to_string())
            } else {
                None
            }
        });

    let token = match token {
        Some(t) => t,
        None => {
            return ws.on_upgrade(|mut socket| async move {
                let _ = socket.close().await;
            });
        }
    };

    let claims = decode::<Claims>(
        &token,
        &DecodingKey::from_secret(state.config.jwt_secret.as_bytes()),
        &Validation::default(),
    );

    match claims {
        Ok(token_data) => {
            let user_id = token_data.claims.user_id;
            ws.protocols(["bearer"])
                .on_upgrade(move |socket| handle_socket(socket, state, user_id))
        }
        Err(_) => {
            ws.on_upgrade(|mut socket| async move {
                let _ = socket.close().await;
            })
        }
    }
}

async fn handle_socket(socket: WebSocket, state: AppState, user_id: String) {
    let (mut sender, mut receiver) = socket.split();

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
