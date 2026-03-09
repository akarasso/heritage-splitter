use aws_sdk_s3::Client as S3Client;
use aws_sdk_s3::config::{Credentials, Region};
use aws_sdk_s3::primitives::ByteStream;

/// S3-compatible image storage backed by MinIO.
#[derive(Clone)]
pub struct ImageStorage {
    client: S3Client,
    bucket: String,
}

impl ImageStorage {
    pub async fn new(endpoint: &str, access_key: &str, secret_key: &str, bucket: &str) -> anyhow::Result<Self> {
        let creds = Credentials::new(access_key, secret_key, None, None, "heritage");
        let config = aws_sdk_s3::Config::builder()
            .endpoint_url(endpoint)
            .region(Region::new("us-east-1"))
            .credentials_provider(creds)
            .force_path_style(true)
            .behavior_version_latest()
            .build();

        let client = S3Client::from_conf(config);

        // Auto-create bucket if it doesn't exist
        match client.head_bucket().bucket(bucket).send().await {
            Ok(_) => {}
            Err(_) => {
                client.create_bucket().bucket(bucket).send().await
                    .map_err(|e| anyhow::anyhow!("Failed to create bucket '{}': {}", bucket, e))?;
                tracing::info!("Created MinIO bucket '{}'", bucket);
            }
        }

        Ok(Self {
            client,
            bucket: bucket.to_string(),
        })
    }

    /// Upload an object. Returns the key.
    pub async fn upload(&self, key: &str, data: Vec<u8>, content_type: &str) -> anyhow::Result<String> {
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .body(ByteStream::from(data))
            .content_type(content_type)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("S3 upload failed for '{}': {}", key, e))?;

        Ok(key.to_string())
    }

    /// Download an object. Returns (bytes, content_type).
    pub async fn get(&self, key: &str) -> anyhow::Result<(Vec<u8>, String)> {
        let resp = self.client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("S3 get failed for '{}': {}", key, e))?;

        let content_type = resp.content_type().unwrap_or("application/octet-stream").to_string();
        let bytes = resp.body.collect().await
            .map_err(|e| anyhow::anyhow!("S3 read body failed: {}", e))?
            .into_bytes()
            .to_vec();

        Ok((bytes, content_type))
    }

    /// Delete an object.
    pub async fn delete(&self, key: &str) -> anyhow::Result<()> {
        self.client
            .delete_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("S3 delete failed for '{}': {}", key, e))?;
        Ok(())
    }
}
