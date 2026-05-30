use pyo3::prelude::*;
use pyo3::types::{PyDict, PyType};
use std::sync::OnceLock;

static QUEUE: OnceLock<PyObject> = OnceLock::new();

#[pyclass]
pub struct WebhookQueueList;

#[pymethods]
impl WebhookQueueList {
    #[classmethod]
    pub fn get_queue(_cls: &Bound<'_, PyType>, py: Python) -> PyResult<PyObject> {
        // Fast path: if the queue is already initialized, return the pointer instantly.
        if let Some(q) = QUEUE.get() {
            return Ok(q.clone_ref(py));
        }

        // Slow path: Ask Python for the config and initialize the asyncio.Queue
        let config_mod = py.import_bound("config.provider")?;
        let provider_cls = config_mod.getattr("GlobalConfigProvider")?;
        let provider_inst = provider_cls.call0()?;
        let config = provider_inst.call_method0("get_config")?;

        let maxsize: usize = config
            .getattr("webhooks")?
            .getattr("queue_size")?
            .extract()?;

        let asyncio = py.import_bound("asyncio")?;
        let queue_cls = asyncio.getattr("Queue")?;

        let kwargs = PyDict::new_bound(py);
        kwargs.set_item("maxsize", maxsize)?;

        let q = queue_cls.call((), Some(&kwargs))?.into();

        // Cache the memory pointer
        let _ = QUEUE.set(q);
        Ok(QUEUE.get().unwrap().clone_ref(py))
    }
}
