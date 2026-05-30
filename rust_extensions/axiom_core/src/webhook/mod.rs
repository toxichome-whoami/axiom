pub mod circuit_breaker;
pub mod queue;
pub mod signer;

use pyo3::prelude::*;

#[pymodule]
pub fn webhook(_py: Python, m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<circuit_breaker::CircuitBreaker>()?;
    m.add_function(wrap_pyfunction!(circuit_breaker::get_circuit_breaker, m)?)?;
    m.add_function(wrap_pyfunction!(signer::generate_signature, m)?)?;
    m.add_class::<queue::WebhookQueueList>()?;
    Ok(())
}
