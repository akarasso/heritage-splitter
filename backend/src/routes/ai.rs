use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};

use crate::AppState;

#[derive(Deserialize)]
pub struct GenerateRequest {
    pub prompt: String,
    /// Optional max tokens (default 256)
    pub max_tokens: Option<u32>,
}

#[derive(Serialize)]
pub struct GenerateResponse {
    pub text: String,
}

#[derive(Serialize)]
struct ClaudeMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct ClaudeRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<ClaudeMessage>,
}

#[derive(Deserialize)]
struct ClaudeContentBlock {
    text: Option<String>,
}

#[derive(Deserialize)]
struct ClaudeResponse {
    content: Vec<ClaudeContentBlock>,
}

pub async fn generate(
    State(state): State<AppState>,
    Json(req): Json<GenerateRequest>,
) -> Result<Json<GenerateResponse>, StatusCode> {
    if state.config.anthropic_api_key.is_empty() {
        tracing::error!("ANTHROPIC_API_KEY not set");
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }

    if req.prompt.len() > 10_000 {
        tracing::warn!("AI prompt too long: {} chars", req.prompt.len());
        return Err(StatusCode::BAD_REQUEST);
    }

    let client = reqwest::Client::new();

    let claude_req = ClaudeRequest {
        model: "claude-haiku-4-5-20251001".to_string(),
        max_tokens: req.max_tokens.unwrap_or(256).min(2048),
        messages: vec![ClaudeMessage {
            role: "user".to_string(),
            content: req.prompt,
        }],
    };

    let res = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &state.config.anthropic_api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&claude_req)
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Anthropic API request failed: {}", e);
            StatusCode::BAD_GATEWAY
        })?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        tracing::error!("Anthropic API error {}: {}", status, body);
        return Err(StatusCode::BAD_GATEWAY);
    }

    let claude_res: ClaudeResponse = res.json().await.map_err(|e| {
        tracing::error!("Failed to parse Anthropic response: {}", e);
        StatusCode::BAD_GATEWAY
    })?;

    let text = claude_res
        .content
        .into_iter()
        .filter_map(|b| b.text)
        .collect::<Vec<_>>()
        .join("");

    Ok(Json(GenerateResponse { text }))
}

// --- DALL-E Image Generation ---

#[derive(Deserialize)]
pub struct GenerateImageRequest {
    pub prompt: String,
    pub size: Option<String>,
}

#[derive(Serialize)]
pub struct GenerateImageResponse {
    pub image_base64: String,
}

#[derive(Serialize)]
struct DalleRequest {
    model: String,
    prompt: String,
    n: u32,
    size: String,
    response_format: String,
}

#[derive(Deserialize)]
struct DalleDataItem {
    b64_json: Option<String>,
}

#[derive(Deserialize)]
struct DalleResponse {
    data: Vec<DalleDataItem>,
}

pub async fn generate_image(
    State(state): State<AppState>,
    Json(req): Json<GenerateImageRequest>,
) -> Result<Json<GenerateImageResponse>, StatusCode> {
    if state.config.openai_api_key.is_empty() {
        tracing::error!("OPENAI_API_KEY not set");
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }

    if req.prompt.len() > 4000 {
        tracing::warn!("Image prompt too long: {} chars", req.prompt.len());
        return Err(StatusCode::BAD_REQUEST);
    }

    let client = reqwest::Client::new();

    let dalle_req = DalleRequest {
        model: "dall-e-2".to_string(),
        prompt: req.prompt,
        n: 1,
        size: {
            let s = req.size.unwrap_or_else(|| "1024x1024".to_string());
            if ["256x256", "512x512", "1024x1024"].contains(&s.as_str()) { s } else { "1024x1024".to_string() }
        },
        response_format: "b64_json".to_string(),
    };

    let res = client
        .post("https://api.openai.com/v1/images/generations")
        .header("Authorization", format!("Bearer {}", state.config.openai_api_key))
        .header("content-type", "application/json")
        .json(&dalle_req)
        .send()
        .await
        .map_err(|e| {
            tracing::error!("OpenAI API request failed: {}", e);
            StatusCode::BAD_GATEWAY
        })?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        tracing::error!("OpenAI API error {}: {}", status, body);
        return Err(StatusCode::BAD_GATEWAY);
    }

    let dalle_res: DalleResponse = res.json().await.map_err(|e| {
        tracing::error!("Failed to parse OpenAI response: {}", e);
        StatusCode::BAD_GATEWAY
    })?;

    let b64 = dalle_res
        .data
        .into_iter()
        .find_map(|d| d.b64_json)
        .ok_or_else(|| {
            tracing::error!("No image data in OpenAI response");
            StatusCode::BAD_GATEWAY
        })?;

    Ok(Json(GenerateImageResponse { image_base64: b64 }))
}
