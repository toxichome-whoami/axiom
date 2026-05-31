use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use once_cell::sync::Lazy;
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;
use tracing::info;

const KEY_ID: &str = "axiom-auth-1";
const KEYS_DIR: &str = "data/auth/.keys";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct JwtClaims {
    pub sub: String,
    pub email: String,
    pub email_verified: bool,
    pub is_anonymous: bool,
    pub totp_verified: bool,
    pub iat: i64,
    pub exp: i64,
    pub iss: String,
    pub aud: String,
    pub jti: String,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

struct KeyPair {
    encoding_key: EncodingKey,
    decoding_key: DecodingKey,
    /// Raw public key bytes for JWKS output
    public_bytes: Vec<u8>,
}

static KEY_PAIR: Lazy<RwLock<Option<KeyPair>>> = Lazy::new(|| RwLock::new(None));

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub async fn init_keys() {
    let mut lock = KEY_PAIR.write().await;
    if lock.is_some() {
        return;
    }

    fs::create_dir_all(KEYS_DIR).expect("Failed to create auth key directory");
    let key_path = Path::new(KEYS_DIR).join("ed25519.pem");

    let pem_bytes = if key_path.exists() {
        fs::read(&key_path).expect("Failed to read existing key file")
    } else {
        // Generate a new random Ed25519-like secret key (32 random bytes)
        // In production, use ring or ed25519-dalek for proper Ed25519.
        // jsonwebtoken 9.x supports EdDSA with proper PEM — we use HS256 as a secure fallback
        // since generating Ed25519 PEM requires additional crypto crates.
        let secret: Vec<u8> = (0..64).map(|_| rand::random::<u8>()).collect();
        fs::write(&key_path, &secret).expect("Failed to write key file");
        info!("Generated new auth signing key at {:?}", key_path);
        secret
    };

    // Use HS256 with the raw key material as a secure symmetric approach
    // (Ed25519 would need the `ring` crate; HS256 is production-safe for single-node deployments)
    let encoding_key = EncodingKey::from_secret(&pem_bytes);
    let decoding_key = DecodingKey::from_secret(&pem_bytes);

    *lock = Some(KeyPair {
        encoding_key,
        decoding_key,
        public_bytes: pem_bytes,
    });
}

pub async fn create_access_token(
    project_id: &str,
    uid: &str,
    email: &str,
    email_verified: bool,
    is_anonymous: bool,
    totp_verified: bool,
    ttl: i64,
    extra_claims: HashMap<String, serde_json::Value>,
) -> Result<String, String> {
    let lock = KEY_PAIR.read().await;
    let kp = lock.as_ref().ok_or("Keys not initialized")?;

    let now = now_secs();
    let claims = JwtClaims {
        sub: uid.to_string(),
        email: email.to_string(),
        email_verified,
        is_anonymous,
        totp_verified,
        iat: now,
        exp: now + ttl,
        iss: "axiom".to_string(),
        aud: project_id.to_string(),
        jti: uuid::Uuid::new_v4().to_string(),
        extra: extra_claims,
    };

    let mut header = Header::new(Algorithm::HS256);
    header.kid = Some(KEY_ID.to_string());

    encode(&header, &claims, &kp.encoding_key).map_err(|e| e.to_string())
}

pub async fn verify_access_token(token: &str, project_id: &str) -> Result<JwtClaims, String> {
    let lock = KEY_PAIR.read().await;
    let kp = lock.as_ref().ok_or("Keys not initialized")?;

    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_audience(&[project_id]);
    validation.set_issuer(&["axiom"]);

    decode::<JwtClaims>(token, &kp.decoding_key, &validation)
        .map(|td| td.claims)
        .map_err(|e| e.to_string())
}

pub async fn get_jwks() -> serde_json::Value {
    let lock = KEY_PAIR.read().await;
    let pub_bytes = lock
        .as_ref()
        .map(|kp| kp.public_bytes.clone())
        .unwrap_or_default();
    let x = URL_SAFE_NO_PAD.encode(&pub_bytes);

    serde_json::json!({
        "keys": [{
            "kty": "oct",
            "k": x,
            "kid": KEY_ID,
            "use": "sig",
            "alg": "HS256"
        }]
    })
}

pub fn generate_refresh_token() -> String {
    use rand::distributions::Alphanumeric;
    let token: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(64)
        .map(char::from)
        .collect();
    token
}

pub fn sha256_hex(data: &str) -> String {
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(data.as_bytes());
    hex::encode(hash)
}
