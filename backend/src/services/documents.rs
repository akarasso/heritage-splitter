use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, AeadCore,
};
use base64::Engine;
use sha2::{Digest, Sha256};

pub fn compute_sha256(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

pub fn encrypt_document(data: &[u8]) -> anyhow::Result<(Vec<u8>, String, String)> {
    let key = Aes256Gcm::generate_key(OsRng);
    let cipher = Aes256Gcm::new(&key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);

    let ciphertext = cipher
        .encrypt(&nonce, data)
        .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;

    let b64 = base64::engine::general_purpose::STANDARD;
    let key_b64 = b64.encode(&key[..]);
    let iv_b64 = b64.encode(&nonce[..]);

    Ok((ciphertext, key_b64, iv_b64))
}

pub fn decrypt_document(ciphertext: &[u8], key_b64: &str, iv_b64: &str) -> anyhow::Result<Vec<u8>> {
    let b64 = base64::engine::general_purpose::STANDARD;
    let key_bytes = b64.decode(key_b64)?;
    let iv_bytes = b64.decode(iv_b64)?;

    #[allow(deprecated)]
    let key = aes_gcm::Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    #[allow(deprecated)]
    let nonce = aes_gcm::Nonce::from_slice(&iv_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| anyhow::anyhow!("Decryption failed: {}", e))?;

    Ok(plaintext)
}

pub async fn get_certification_on_chain(
    rpc_url: &str,
    registry_address: &str,
    hash: &str,
) -> anyhow::Result<u64> {
    use alloy::sol;
    use alloy::providers::ProviderBuilder;
    use alloy::primitives::{Address, FixedBytes};
    use std::str::FromStr;

    sol! {
        #[sol(rpc)]
        contract DocumentRegistry {
            function getCertification(bytes32 hash) external view returns (uint256);
        }
    }

    let provider = ProviderBuilder::new()
        .connect_http(rpc_url.parse()?);

    let addr = Address::from_str(registry_address)?;
    let contract = DocumentRegistry::new(addr, &provider);

    let hash_bytes: [u8; 32] = hex::decode(hash)?
        .try_into()
        .map_err(|_| anyhow::anyhow!("Invalid hash length"))?;

    let result = contract.getCertification(FixedBytes::from(hash_bytes)).call().await?;

    Ok(result.to::<u64>())
}

pub async fn get_certifier_nonce_on_chain(
    rpc_url: &str,
    registry_address: &str,
    wallet_address: &str,
) -> anyhow::Result<u64> {
    use alloy::sol;
    use alloy::providers::ProviderBuilder;
    use alloy::primitives::Address;
    use std::str::FromStr;

    sol! {
        #[sol(rpc)]
        contract DocumentRegistry {
            function nonces(address) external view returns (uint256);
        }
    }

    let provider = ProviderBuilder::new()
        .connect_http(rpc_url.parse()?);

    let addr = Address::from_str(registry_address)?;
    let contract = DocumentRegistry::new(addr, &provider);
    let wallet = Address::from_str(wallet_address)?;

    let result = contract.nonces(wallet).call().await?;

    Ok(result.to::<u64>())
}

pub async fn get_certifier_on_chain(
    rpc_url: &str,
    registry_address: &str,
    hash: &str,
) -> anyhow::Result<String> {
    use alloy::sol;
    use alloy::providers::ProviderBuilder;
    use alloy::primitives::{Address, FixedBytes};
    use std::str::FromStr;

    sol! {
        #[sol(rpc)]
        contract DocumentRegistry {
            function certifiers(bytes32 hash) external view returns (address);
        }
    }

    let provider = ProviderBuilder::new()
        .connect_http(rpc_url.parse()?);

    let addr = Address::from_str(registry_address)?;
    let contract = DocumentRegistry::new(addr, &provider);

    let hash_bytes: [u8; 32] = hex::decode(hash)?
        .try_into()
        .map_err(|_| anyhow::anyhow!("Invalid hash length"))?;

    let result = contract.certifiers(FixedBytes::from(hash_bytes)).call().await?;

    Ok(format!("0x{}", hex::encode(result.as_slice())))
}

pub async fn certify_on_chain_for(
    rpc_url: &str,
    private_key: &str,
    registry_address: &str,
    hash: &str,
    certifier_address: &str,
    deadline: u64,
    signature: &str,
) -> anyhow::Result<String> {
    use alloy::sol;
    use alloy::providers::ProviderBuilder;
    use alloy::signers::local::PrivateKeySigner;
    use alloy::primitives::{Address, FixedBytes, Bytes, U256};
    use std::str::FromStr;

    sol! {
        #[sol(rpc)]
        contract DocumentRegistry {
            function certifyFor(bytes32 hash, address certifier, uint256 deadline, bytes calldata signature) external;
        }
    }

    let signer: PrivateKeySigner = private_key.parse()?;
    let provider = ProviderBuilder::new()
        .wallet(alloy::network::EthereumWallet::from(signer))
        .connect_http(rpc_url.parse()?);

    let addr = Address::from_str(registry_address)?;
    let contract = DocumentRegistry::new(addr, &provider);

    let hash_bytes: [u8; 32] = hex::decode(hash)?
        .try_into()
        .map_err(|_| anyhow::anyhow!("Invalid hash length"))?;

    let certifier = Address::from_str(certifier_address)?;

    let sig_hex = signature.strip_prefix("0x").unwrap_or(signature);
    let sig_bytes = Bytes::from(hex::decode(sig_hex)?);

    let tx = contract
        .certifyFor(
            FixedBytes::from(hash_bytes),
            certifier,
            U256::from(deadline),
            sig_bytes,
        )
        .send()
        .await?;
    let receipt = tx.get_receipt().await?;

    Ok(format!("0x{}", hex::encode(receipt.transaction_hash.as_slice())))
}
