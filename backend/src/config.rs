use std::env;

#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub avalanche_rpc_url: String,
    pub factory_address: String,
    pub pinata_api_key: String,
    pub pinata_secret_key: String,
    pub chain_id: u64,
    pub anthropic_api_key: String,
    pub openai_api_key: String,
    pub host: String,
    pub port: u16,
    pub document_storage_path: String,
    pub certifier_private_key: String,
    pub doc_registry_address: String,
    pub registry_address: String,
    pub base_url: String,
    pub bot_delay_secs: u64,
    pub cookie_domain: Option<String>,
    pub secure_cookies: bool,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            database_url: env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://heritage.db".into()),
            jwt_secret: env::var("JWT_SECRET").unwrap_or_else(|_| {
                if env::var("ENVIRONMENT").unwrap_or_default() == "production" {
                    panic!("JWT_SECRET must be set in production!");
                }
                tracing::warn!("JWT_SECRET not set, using insecure default! Set JWT_SECRET in production.");
                "dev-secret".into()
            }),
            avalanche_rpc_url: env::var("AVALANCHE_RPC_URL")
                .unwrap_or_else(|_| "https://api.avax-test.network/ext/bc/C/rpc".into()),
            factory_address: env::var("FACTORY_ADDRESS").unwrap_or_default(),
            pinata_api_key: env::var("PINATA_API_KEY").unwrap_or_default(),
            pinata_secret_key: env::var("PINATA_SECRET_KEY").unwrap_or_default(),
            chain_id: env::var("CHAIN_ID")
                .unwrap_or_else(|_| "43113".into())
                .parse()
                .unwrap_or(43113),
            anthropic_api_key: env::var("ANTHROPIC_API_KEY").unwrap_or_default(),
            openai_api_key: env::var("OPENAI_API_KEY").unwrap_or_default(),
            host: env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into()),
            port: env::var("PORT")
                .unwrap_or_else(|_| "3001".into())
                .parse()
                .unwrap_or(3001),
            document_storage_path: env::var("DOCUMENT_STORAGE_PATH")
                .unwrap_or_else(|_| "/documents".into()),
            certifier_private_key: env::var("CERTIFIER_PRIVATE_KEY").unwrap_or_default(),
            doc_registry_address: env::var("DOC_REGISTRY_ADDRESS").unwrap_or_default(),
            registry_address: env::var("REGISTRY_ADDRESS").unwrap_or_default(),
            base_url: env::var("BASE_URL").unwrap_or_else(|_| "https://avax.emblem-tech.eu".into()),
            bot_delay_secs: env::var("BOT_DELAY_SECS")
                .unwrap_or_else(|_| "3".into())
                .parse()
                .unwrap_or(3),
            cookie_domain: env::var("COOKIE_DOMAIN").ok(),
            secure_cookies: env::var("SECURE_COOKIES")
                .unwrap_or_else(|_| "false".into())
                .parse()
                .unwrap_or(false),
        }
    }
}
