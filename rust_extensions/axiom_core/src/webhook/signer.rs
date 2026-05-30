use hmac::{Hmac, Mac};
use pyo3::prelude::*;
use pyo3::types::PyBytes;
use sha2::Sha256;

// Create alias for HMAC-SHA256
type HmacSha256 = Hmac<Sha256>;

#[pyfunction]
pub fn generate_signature(
    _py: Python,
    secret: &str,
    payload: &Bound<'_, PyAny>,
) -> PyResult<String> {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC can take key of any size");

    if let Ok(py_bytes) = payload.downcast::<PyBytes>() {
        mac.update(py_bytes.as_bytes());
    } else if let Ok(py_str) = payload.downcast::<pyo3::types::PyString>() {
        mac.update(py_str.to_str()?.as_bytes());
    } else {
        return Err(pyo3::exceptions::PyTypeError::new_err(
            "Payload must be bytes or string",
        ));
    }

    // Extract result and format as hex
    let result = mac.finalize();
    let code_bytes = result.into_bytes();

    Ok(format!("sha256={}", hex::encode(code_bytes)))
}
