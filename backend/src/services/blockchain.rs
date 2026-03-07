use alloy::sol;
use alloy::providers::{Provider, ProviderBuilder};
use alloy::signers::local::PrivateKeySigner;
use alloy::primitives::{Address, U256};
use alloy::sol_types::SolEvent;
use alloy::rpc::types::Filter;
use serde::Serialize;
use std::str::FromStr;

sol! {
    #[sol(rpc)]
    contract CollectionFactory {
        event CollectionCreated(
            uint256 indexed index,
            address nft,
            address splitter,
            address vault,
            address owner,
            string name,
            string symbol
        );

        function createCollection(
            string calldata name,
            string calldata symbol,
            address owner,
            address[] calldata wallets,
            uint256[] calldata shares,
            uint96 royaltyBps,
            string calldata contractURI,
            address minter,
            address registry
        ) external returns (uint256 index, address nftAddr, address splitterAddr, address vaultAddr);
    }

    #[sol(rpc)]
    contract CollectionNFT {
        function mintBatch(address to, string[] calldata uris) external returns (uint256[] memory);
    }

    #[sol(rpc)]
    contract NFTMarket {
        function setPriceBatch(uint256[] calldata tokenIds, uint256[] calldata prices) external;
    }
}

#[derive(Debug, Clone)]
pub struct DeployResult {
    pub nft_address: String,
    pub splitter_address: String,
    pub vault_address: String,
    pub block_number: u64,
}

/// Deploy a collection on-chain:
/// 1. Call factory.createCollection() → NFT + Splitter + Market
/// 2. Mint NFTs into market
/// 3. Set prices
pub async fn deploy_collection(
    rpc_url: &str,
    private_key: &str,
    factory_address: &str,
    producer_address: &str,
    collection_name: &str,
    collection_symbol: &str,
    wallets: Vec<String>,
    shares: Vec<u64>,
    royalty_bps: u64,
    nft_uris: Vec<String>,
    nft_prices_wei: Vec<U256>,
    registry_address: &str,
    metadata_base_url: Option<&str>,
) -> anyhow::Result<DeployResult> {
    let signer: PrivateKeySigner = private_key.parse()?;
    let minter_address = signer.address();

    let provider = ProviderBuilder::new()
        .wallet(alloy::network::EthereumWallet::from(signer))
        .connect_http(rpc_url.parse()?);

    let factory_addr = Address::from_str(factory_address)?;
    let producer_addr = Address::from_str(producer_address)?;
    let registry_addr = Address::from_str(registry_address)?;

    // Convert wallets to Address
    let wallet_addrs: Vec<Address> = wallets
        .iter()
        .map(|w| Address::from_str(w))
        .collect::<Result<_, _>>()?;
    let share_vals: Vec<U256> = shares.iter().map(|s| U256::from(*s)).collect();

    // Step 1: Deploy via factory
    let factory = CollectionFactory::new(factory_addr, &provider);
    let tx = factory
        .createCollection(
            collection_name.to_string(),
            collection_symbol.to_string(),
            producer_addr,
            wallet_addrs,
            share_vals,
            alloy::primitives::Uint::<96, 2>::from(royalty_bps),
            String::new(), // contractURI
            minter_address,
            registry_addr,
        )
        .send()
        .await?;

    let receipt = tx.get_receipt().await?;

    // Extract addresses from CollectionCreated event
    let event = receipt
        .inner
        .logs()
        .iter()
        .find_map(|log| {
            CollectionFactory::CollectionCreated::decode_log(&log.inner).ok()
        })
        .ok_or_else(|| anyhow::anyhow!("CollectionCreated event not found"))?;

    let nft_address = format!("{:?}", event.data.nft);
    let splitter_address = format!("{:?}", event.data.splitter);
    let vault_address = format!("{:?}", event.data.vault);
    let block_number = receipt.block_number.unwrap_or(0);

    // Validate addresses from event log before storing in DB
    for (label, addr) in [("NFT", &nft_address), ("Splitter", &splitter_address), ("Vault", &vault_address)] {
        if Address::from_str(addr).is_err() {
            return Err(anyhow::anyhow!("Invalid {} address from event log: {}", label, addr));
        }
    }

    tracing::info!(
        "Collection deployed: NFT={}, Splitter={}, Market={}, Block={}",
        nft_address, splitter_address, vault_address, block_number
    );

    // Step 2: Mint NFTs into vault (if any)
    if !nft_uris.is_empty() {
        // If metadata_base_url is provided, construct proper metadata URLs
        let final_uris = if let Some(base) = metadata_base_url {
            (0..nft_uris.len())
                .map(|i| format!("{}/{}/{}", base.trim_end_matches('/'), nft_address, i))
                .collect()
        } else {
            nft_uris
        };

        let nft = CollectionNFT::new(event.data.nft, &provider);
        let mint_tx = nft
            .mintBatch(event.data.vault, final_uris)
            .send()
            .await?;
        let mint_receipt = mint_tx.get_receipt().await?;
        tracing::info!("NFTs minted, tx: {:?}", mint_receipt.transaction_hash);

        // Step 3: Set prices (only for NFTs with a price > 0)
        let prices_to_set: Vec<(usize, &U256)> = nft_prices_wei
            .iter()
            .enumerate()
            .filter(|(_, p)| **p > U256::ZERO)
            .collect();

        if !prices_to_set.is_empty() {
            let token_ids: Vec<U256> = prices_to_set.iter().map(|(i, _)| U256::from(*i)).collect();
            let prices: Vec<U256> = prices_to_set.iter().map(|(_, p)| **p).collect();

            let vault = NFTMarket::new(event.data.vault, &provider);
            let price_tx = vault
                .setPriceBatch(token_ids, prices)
                .send()
                .await?;
            let price_receipt = price_tx.get_receipt().await?;
            tracing::info!("Prices set, tx: {:?}", price_receipt.transaction_hash);
        }
    }

    Ok(DeployResult {
        nft_address,
        splitter_address,
        vault_address,
        block_number,
    })
}

/// Mint additional NFTs into an existing vault and set their prices
pub async fn mint_additional_nfts(
    rpc_url: &str,
    private_key: &str,
    nft_address: &str,
    vault_address: &str,
    uris: Vec<String>,
    token_ids: Vec<u64>,
    prices_wei: Vec<U256>,
) -> anyhow::Result<()> {
    let signer: PrivateKeySigner = private_key.parse()?;
    let provider = ProviderBuilder::new()
        .wallet(alloy::network::EthereumWallet::from(signer))
        .connect_http(rpc_url.parse()?);

    let nft_addr = Address::from_str(nft_address)?;
    let vault_addr = Address::from_str(vault_address)?;

    // Mint into vault
    let nft = CollectionNFT::new(nft_addr, &provider);
    let mint_tx = nft.mintBatch(vault_addr, uris).send().await?;
    let mint_receipt = mint_tx.get_receipt().await?;
    tracing::info!("Additional NFTs minted, tx: {:?}", mint_receipt.transaction_hash);

    // Set prices
    let prices_to_set: Vec<(u64, &U256)> = token_ids
        .iter()
        .zip(prices_wei.iter())
        .filter(|(_, p)| **p > U256::ZERO)
        .map(|(id, p)| (*id, p))
        .collect();

    if !prices_to_set.is_empty() {
        let ids: Vec<U256> = prices_to_set.iter().map(|(id, _)| U256::from(*id)).collect();
        let prices: Vec<U256> = prices_to_set.iter().map(|(_, p)| **p).collect();

        let vault = NFTMarket::new(vault_addr, &provider);
        let price_tx = vault.setPriceBatch(ids, prices).send().await?;
        let price_receipt = price_tx.get_receipt().await?;
        tracing::info!("Prices set, tx: {:?}", price_receipt.transaction_hash);
    }

    Ok(())
}

// ── On-chain event indexing ─────────────────────────────────────────

sol! {
    // ERC-721 Transfer event
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    // NFTMarket purchase event
    event NFTPurchased(uint256 indexed tokenId, address indexed buyer, uint256 price);
    // ArtistsSplitter payment event
    event Paid(address indexed beneficiary, uint256 amount);
    // Splitter received event
    event Received(uint256 amount);
}

#[derive(Debug, Clone, Serialize)]
pub struct TokenTransferEvent {
    pub from: String,
    pub to: String,
    pub token_id: u64,
    pub block_number: u64,
    pub tx_hash: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PurchaseEvent {
    pub token_id: u64,
    pub buyer: String,
    pub price_wei: String,
    pub block_number: u64,
    pub tx_hash: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PaymentEvent {
    pub beneficiary: String,
    pub amount_wei: String,
    pub block_number: u64,
    pub tx_hash: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TokenHistory {
    pub transfers: Vec<TokenTransferEvent>,
    pub purchases: Vec<PurchaseEvent>,
    pub payments: Vec<PaymentEvent>,
    pub total_revenue_wei: String,
}

const LOG_CHUNK_SIZE: u64 = 2048;

/// Fetch logs in chunks to avoid RPC block range limits.
async fn get_logs_chunked(
    provider: &impl Provider,
    base_filter: Filter,
    latest_block: u64,
    deploy_block: u64,
) -> anyhow::Result<Vec<alloy::rpc::types::Log>> {
    let mut all_logs = Vec::new();
    let mut from = deploy_block;
    while from <= latest_block {
        let to = (from + LOG_CHUNK_SIZE - 1).min(latest_block);
        let filter = base_filter.clone().from_block(from).to_block(to);
        let logs = provider.get_logs(&filter).await?;
        all_logs.extend(logs);
        from = to + 1;
    }
    Ok(all_logs)
}

/// Result of an incremental scan — includes the last block scanned.
pub struct ScanResult {
    pub transfers: Vec<TokenTransferEvent>,
    pub purchases: Vec<PurchaseEvent>,
    pub payments: Vec<PaymentEvent>,
    pub last_scanned_block: u64,
}

/// Fetch on-chain events for a collection, starting from `from_block`.
/// Returns only the NEW events since `from_block`.
pub async fn fetch_collection_events(
    rpc_url: &str,
    nft_address: &str,
    vault_address: &str,
    splitter_address: &str,
    from_block: u64,
) -> anyhow::Result<ScanResult> {
    let provider = ProviderBuilder::new()
        .connect_http(rpc_url.parse()?);

    let nft_addr = Address::from_str(nft_address)?;
    let vault_addr = Address::from_str(vault_address)?;
    let splitter_addr = Address::from_str(splitter_address)?;

    let latest_block = provider.get_block_number().await?;
    if from_block > latest_block {
        return Ok(ScanResult {
            transfers: vec![], purchases: vec![], payments: vec![],
            last_scanned_block: latest_block,
        });
    }

    // Query Transfer events from NFT contract
    let transfer_filter = Filter::new()
        .address(nft_addr)
        .event_signature(Transfer::SIGNATURE_HASH);

    let transfer_logs = get_logs_chunked(&provider, transfer_filter, latest_block, from_block).await?;

    let transfers: Vec<TokenTransferEvent> = transfer_logs.iter().filter_map(|log| {
        let decoded = Transfer::decode_log(&log.inner).ok()?;
        Some(TokenTransferEvent {
            from: format!("{:?}", decoded.data.from),
            to: format!("{:?}", decoded.data.to),
            token_id: decoded.data.tokenId.try_into().ok()?,
            block_number: log.block_number?,
            tx_hash: format!("{:?}", log.transaction_hash?),
        })
    }).collect();

    // Query NFTPurchased events from Vault
    let purchase_filter = Filter::new()
        .address(vault_addr)
        .event_signature(NFTPurchased::SIGNATURE_HASH);

    let purchase_logs = get_logs_chunked(&provider, purchase_filter, latest_block, from_block).await?;

    let purchases: Vec<PurchaseEvent> = purchase_logs.iter().filter_map(|log| {
        let decoded = NFTPurchased::decode_log(&log.inner).ok()?;
        Some(PurchaseEvent {
            token_id: decoded.data.tokenId.try_into().ok()?,
            buyer: format!("{:?}", decoded.data.buyer),
            price_wei: decoded.data.price.to_string(),
            block_number: log.block_number?,
            tx_hash: format!("{:?}", log.transaction_hash?),
        })
    }).collect();

    // Query Paid events from Splitter
    let paid_filter = Filter::new()
        .address(splitter_addr)
        .event_signature(Paid::SIGNATURE_HASH);

    let paid_logs = get_logs_chunked(&provider, paid_filter, latest_block, from_block).await?;

    let payments: Vec<PaymentEvent> = paid_logs.iter().filter_map(|log| {
        let decoded = Paid::decode_log(&log.inner).ok()?;
        Some(PaymentEvent {
            beneficiary: format!("{:?}", decoded.data.beneficiary),
            amount_wei: decoded.data.amount.to_string(),
            block_number: log.block_number?,
            tx_hash: format!("{:?}", log.transaction_hash?),
        })
    }).collect();

    Ok(ScanResult {
        transfers,
        purchases,
        payments,
        last_scanned_block: latest_block,
    })
}
