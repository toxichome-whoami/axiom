pub mod circuit_breaker;
pub mod persistence;
pub mod queue;
pub mod signer;
pub mod emitter;

use pyo3::prelude::*;

#[pymodule]
pub fn webhook(_py: Python, m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<circuit_breaker::CircuitBreaker>()?;
    m.add_function(wrap_pyfunction!(circuit_breaker::get_circuit_breaker, m)?)?;
    m.add_function(wrap_pyfunction!(signer::generate_signature, m)?)?;
    m.add_class::<queue::WebhookQueueList>()?;
    persistence::bind_persistence(_py, m)?;
    emitter::bind_emitter(_py, m)?;
    Ok(())
}
