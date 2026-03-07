use std::sync::Arc;

use serde::Serialize;
use sqlx::sqlite::Sqlite;
use tokio::sync::broadcast;

#[derive(Debug, Clone, Serialize)]
pub struct WsEvent {
    pub user_id: String,
    pub kind: String,
    pub payload: serde_json::Value,
}

pub async fn create_notification<'e, E>(
    executor: E,
    notifier: &Arc<broadcast::Sender<WsEvent>>,
    user_id: &str,
    kind: &str,
    title: &str,
    body: &str,
    project_id: Option<&str>,
    reference_id: Option<&str>,
) -> Result<String, sqlx::Error>
where
    E: sqlx::Executor<'e, Database = Sqlite>,
{
    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO notifications (id, user_id, kind, title, body, project_id, reference_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(user_id)
    .bind(kind)
    .bind(title)
    .bind(body)
    .bind(project_id)
    .bind(reference_id)
    .execute(executor)
    .await?;

    // Broadcast via WebSocket
    let _ = notifier.send(WsEvent {
        user_id: user_id.to_string(),
        kind: kind.to_string(),
        payload: serde_json::json!({
            "id": id,
            "title": title,
            "body": body,
            "project_id": project_id,
            "reference_id": reference_id,
        }),
    });

    Ok(id)
}
