use sqlx::SqlitePool;

/// Log an audit event to the audit_logs table.
pub async fn audit_log(
    pool: &SqlitePool,
    user_id: &str,
    action: &str,
    resource_type: &str,
    resource_id: &str,
    details: &str,
) {
    let id = uuid::Uuid::new_v4().to_string();
    let result = sqlx::query(
        "INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(user_id)
    .bind(action)
    .bind(resource_type)
    .bind(resource_id)
    .bind(details)
    .execute(pool)
    .await;

    if let Err(e) = result {
        tracing::warn!("Failed to write audit log: {}", e);
    }
}
