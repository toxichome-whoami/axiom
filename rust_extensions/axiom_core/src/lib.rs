pub mod webhook;

use pyo3::prelude::*;

#[pymodule]
fn axiom_core(py: Python, m: &Bound<'_, PyModule>) -> PyResult<()> {
    // We create a python submodule so users can do:
    // from axiom_core.webhook.circuit_breaker import get_circuit_breaker
    
    let webhook_module = PyModule::new_bound(py, "webhook")?;
    webhook::webhook(py, &webhook_module)?;
    
    m.add_submodule(&webhook_module)?;
    
    // Register the submodule in sys.modules so Python can import it absolutely
    py.import_bound("sys")?
        .getattr("modules")?
        .set_item("axiom_core.webhook", webhook_module)?;
    
    Ok(())
}
