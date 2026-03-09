pub mod auth;
pub mod users;
pub mod projects;
pub mod participants;
pub mod allocations;
pub mod public;
pub mod messages;
pub mod notifications;
pub mod direct_messages;
pub mod ws;
pub mod documents;
pub mod collections;
pub mod showrooms;
pub mod images;
pub mod health;

use sqlx::SqlitePool;

/// Check if a user is a member of a project (creator, accepted or invited participant).
/// Invited users get read access so they can view the project and accept the invitation.
pub async fn is_project_member(pool: &SqlitePool, project_id: &str, user_id: &str) -> bool {
    let is_creator: bool = sqlx::query_scalar(
        "SELECT COUNT(*) > 0 FROM projects WHERE id = ? AND creator_id = ?"
    )
    .bind(project_id)
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    if is_creator {
        return true;
    }

    sqlx::query_scalar(
        "SELECT COUNT(*) > 0 FROM participants WHERE project_id = ? AND user_id = ? AND status IN ('accepted', 'invited')"
    )
    .bind(project_id)
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap_or(false)
}
