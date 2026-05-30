use hmac::{Hmac, Mac};
use sha2::Sha256;

// Create alias for HMAC-SHA256
type HmacSha256 = Hmac<Sha256>;

pub fn generate_signature(
    secret: &str,
    payload: &[u8],
) -> Result<String, Box<dyn std::error::Error>> {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC can take key of any size");

    mac.update(payload);

    // Extract result and format as hex
    let result = mac.finalize();
    let code_bytes = result.into_bytes();

    Ok(format!("sha256={}", hex::encode(code_bytes)))
}
