use pyo3::prelude::*;
use pyo3::types::{PyDict, PyString};
use rusqlite::{params, Connection, OptionalExtension, Result as SqlResult};
use serde_json::Value;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::runtime::Runtime;

// Global Tokio runtime for background network I/O
static ASYNC_RT: OnceLock<Runtime> = OnceLock::new();
static PERSISTENCE: OnceLock<Py<WebhookPersistence>> = OnceLock::new();

fn get_rt() -> &'static Runtime {
    ASYNC_RT.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap()
    })
}

#[pyclass]
#[derive(Clone)]
pub struct WebhookPersistence {
    #[pyo3(get)]
    pub db_path: String,
    backend: String,
    redis_url: Option<String>,
    nats_url: Option<String>,
}

#[pymethods]
impl WebhookPersistence {
    #[new]
    pub fn new(db_path: String) -> Self {
        Self {
            db_path,
            backend: "sqlite".to_string(),
            redis_url: None,
            nats_url: None,
        }
    }

    pub fn init_db(&mut self, py: Python) -> PyResult<()> {
        let config_mod = py.import_bound("config.provider")?;
        let provider_cls = config_mod.getattr("GlobalConfigProvider")?;
        let provider_inst = provider_cls.call0()?;
        let config = provider_inst.call_method0("get_config")?;

        let eda = config.getattr("eda")?;
        let enabled: bool = eda.getattr("enabled")?.extract()?;
        let backend: String = eda.getattr("backend")?.extract()?;

        if enabled && backend == "redis" {
            self.backend = "redis".to_string();
            self.redis_url = Some(eda.getattr("redis_url")?.extract()?);
            // Spawn background task to init redis stream
            if let Some(url) = self.redis_url.clone() {
                get_rt().spawn(async move {
                    if let Ok(client) = redis::Client::open(url) {
                        if let Ok(mut con) = client.get_multiplexed_async_connection().await {
                            let _: redis::RedisResult<()> = redis::cmd("XGROUP")
                                .arg("CREATE")
                                .arg("axiom_webhooks")
                                .arg("axiom_workers")
                                .arg("$")
                                .arg("MKSTREAM")
                                .query_async(&mut con)
                                .await;
                        }
                    }
                });
            }
            return Ok(());
        }

        if enabled && backend == "nats" {
            self.backend = "nats".to_string();
            self.nats_url = Some(eda.getattr("nats_url")?.extract()?);
            // Spawn background task to init nats stream
            if let Some(url) = self.nats_url.clone() {
                get_rt().spawn(async move {
                    if let Ok(client) = async_nats::connect(url).await {
                        let js = async_nats::jetstream::new(client);
                        let _ = js
                            .create_stream(async_nats::jetstream::stream::Config {
                                name: "axiom_webhooks".to_string(),
                                subjects: vec!["webhooks.*".to_string()],
                                ..Default::default()
                            })
                            .await;
                    }
                });
            }
            return Ok(());
        }

        // SQLite Fallback
        if let Some(parent) = std::path::Path::new(&self.db_path).parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(&self.db_path)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS webhook_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT UNIQUE NOT NULL,
                hook_name TEXT NOT NULL,
                url TEXT NOT NULL,
                secret TEXT NOT NULL,
                headers TEXT,
                payload TEXT NOT NULL,
                attempt INTEGER DEFAULT 1,
                next_retry_at REAL DEFAULT 0,
                status TEXT DEFAULT 'pending',
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS webhook_dead_letter (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                queue_id INTEGER,
                event_id TEXT NOT NULL,
                hook_name TEXT NOT NULL,
                url TEXT NOT NULL,
                payload TEXT NOT NULL,
                attempts INTEGER,
                last_error TEXT,
                died_at TEXT DEFAULT (datetime('now'))
            );",
        )
        .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;

        Ok(())
    }

    pub fn enqueue(
        &self,
        py: Python,
        event_id: String,
        hook_name: String,
        url: String,
        secret: String,
        headers: &Bound<'_, PyAny>,
        payload: String,
    ) -> PyResult<Option<PyObject>> {
        let headers_str = if headers.is_none() {
            "{}".to_string()
        } else {
            let json_mod = py.import_bound("json")?;
            json_mod
                .call_method1("dumps", (headers,))?
                .extract::<String>()?
        };

        if self.backend == "redis" {
            let r_url = self.redis_url.clone().unwrap_or_default();
            let e_id = event_id.clone();
            get_rt().spawn(async move {
                if let Ok(client) = redis::Client::open(r_url) {
                    if let Ok(mut con) = client.get_multiplexed_async_connection().await {
                        let _: redis::RedisResult<()> = redis::cmd("XADD")
                            .arg("axiom_webhooks")
                            .arg("*")
                            .arg("event_id")
                            .arg(&e_id)
                            .arg("hook_name")
                            .arg(&hook_name)
                            .arg("url")
                            .arg(&url)
                            .arg("secret")
                            .arg(&secret)
                            .arg("headers")
                            .arg(&headers_str)
                            .arg("payload")
                            .arg(&payload)
                            .arg("attempt")
                            .arg("1")
                            .query_async(&mut con)
                            .await;
                    }
                }
            });
            return Ok(Some(event_id.into_py(py)));
        }

        if self.backend == "nats" {
            let n_url = self.nats_url.clone().unwrap_or_default();
            let e_id = event_id.clone();
            get_rt().spawn(async move {
                if let Ok(client) = async_nats::connect(n_url).await {
                    let js = async_nats::jetstream::new(client);

                    let mut map = serde_json::Map::new();
                    map.insert("event_id".to_string(), Value::String(e_id));
                    map.insert("hook_name".to_string(), Value::String(hook_name));
                    map.insert("url".to_string(), Value::String(url));
                    map.insert("secret".to_string(), Value::String(secret));
                    map.insert("headers".to_string(), Value::String(headers_str));
                    map.insert("payload".to_string(), Value::String(payload));
                    map.insert("attempt".to_string(), Value::Number(1.into()));

                    let data = serde_json::to_string(&Value::Object(map)).unwrap_or_default();
                    let _ = js
                        .publish("webhooks.enqueue".to_string(), data.into())
                        .await;
                }
            });
            return Ok(Some(event_id.into_py(py)));
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs_f64();

        let conn = Connection::open(&self.db_path)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;

        let res = conn.execute(
            "INSERT INTO webhook_queue (event_id, hook_name, url, secret, headers, payload, next_retry_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![event_id, hook_name, url, secret, headers_str, payload, now],
        );

        match res {
            Ok(_) => Ok(Some(conn.last_insert_rowid().into_py(py))),
            Err(_) => Ok(None),
        }
    }

    pub fn mark_delivered(&self, event_id: String) -> PyResult<()> {
        if self.backend == "redis" {
            let r_url = self.redis_url.clone().unwrap_or_default();
            get_rt().spawn(async move {
                if let Ok(client) = redis::Client::open(r_url) {
                    if let Ok(mut con) = client.get_multiplexed_async_connection().await {
                        let _: redis::RedisResult<()> = redis::cmd("XACK")
                            .arg("axiom_webhooks")
                            .arg("axiom_workers")
                            .arg(&event_id)
                            .query_async(&mut con)
                            .await;
                    }
                }
            });
            return Ok(());
        }

        if self.backend == "nats" {
            return Ok(());
        }

        let conn = Connection::open(&self.db_path)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;
        let _ = conn.execute(
            "DELETE FROM webhook_queue WHERE event_id = ?1",
            params![event_id],
        );
        Ok(())
    }

    pub fn mark_failed(
        &self,
        event_id: String,
        attempt: i64,
        _error: String,
        next_retry_at: f64,
    ) -> PyResult<()> {
        if self.backend != "sqlite" {
            return Ok(());
        }
        let conn = Connection::open(&self.db_path)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;
        let _ = conn.execute(
            "UPDATE webhook_queue SET status='pending', attempt=?1, next_retry_at=?2, updated_at=datetime('now') WHERE event_id = ?3",
            params![attempt, next_retry_at, event_id],
        );
        Ok(())
    }

    pub fn move_to_dead_letter(
        &self,
        queue_id: i64,
        event_id: String,
        hook_name: String,
        url: String,
        payload: String,
        attempts: i64,
        last_error: String,
    ) -> PyResult<()> {
        if self.backend != "sqlite" {
            return Ok(());
        }
        let mut conn = Connection::open(&self.db_path)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;
        let tx = conn
            .transaction()
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;

        let _ = tx.execute(
            "INSERT INTO webhook_dead_letter (queue_id, event_id, hook_name, url, payload, attempts, last_error) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![queue_id, event_id, hook_name, url, payload, attempts, last_error],
        );
        let _ = tx.execute("DELETE FROM webhook_queue WHERE id = ?1", params![queue_id]);
        tx.commit()
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;
        Ok(())
    }

    pub fn purge_expired_dlq(&self, retention_hours: i64) -> PyResult<()> {
        if self.backend != "sqlite" {
            return Ok(());
        }
        let conn = Connection::open(&self.db_path)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;
        let time_modifier = format!("-{} hours", retention_hours);
        let _ = conn.execute(
            "DELETE FROM webhook_dead_letter WHERE died_at < datetime('now', ?1)",
            params![time_modifier],
        );
        Ok(())
    }

    pub fn stats(&self, py: Python) -> PyResult<PyObject> {
        let dict = PyDict::new_bound(py);
        if self.backend != "sqlite" {
            dict.set_item("pending", 0)?;
            dict.set_item("processing", 0)?;
            dict.set_item("dead_letter_count", 0)?;
            dict.set_item("oldest_pending_age", 0)?;
            return Ok(dict.into());
        }

        let conn = match Connection::open(&self.db_path) {
            Ok(c) => c,
            Err(_) => return Ok(dict.into()),
        };

        let mut pending = 0;
        let mut processing = 0;

        if let Ok(mut stmt) =
            conn.prepare("SELECT status, COUNT(*) FROM webhook_queue GROUP BY status")
        {
            let mut rows = stmt.query([]).unwrap();
            while let Ok(Some(row)) = rows.next() {
                let status: String = row.get(0).unwrap_or_default();
                let count: i64 = row.get(1).unwrap_or(0);
                if status == "pending" {
                    pending = count;
                }
                if status == "processing" {
                    processing = count;
                }
            }
        }

        let dlq_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM webhook_dead_letter", [], |row| {
                row.get(0)
            })
            .unwrap_or(0);

        let oldest: Option<String> = conn
            .query_row(
                "SELECT MIN(created_at) FROM webhook_queue WHERE status = 'pending'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(None);

        dict.set_item("pending", pending)?;
        dict.set_item("processing", processing)?;
        dict.set_item("dead_letter_count", dlq_count)?;
        if let Some(o) = oldest {
            dict.set_item("oldest_pending_age", o)?;
        } else {
            dict.set_item("oldest_pending_age", 0)?;
        }

        Ok(dict.into())
    }

    pub fn recover_processing_tasks(&self) -> PyResult<()> {
        if self.backend != "sqlite" {
            return Ok(());
        }
        let conn = Connection::open(&self.db_path)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;
        let _ = conn.execute(
            "UPDATE webhook_queue SET status='pending' WHERE status='processing'",
            [],
        );
        Ok(())
    }

    pub fn fetch_all_pending(&self, py: Python) -> PyResult<Vec<PyObject>> {
        if self.backend != "sqlite" {
            return Ok(vec![]);
        }
        let conn = Connection::open(&self.db_path)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;

        // This is complex to fully map into dynamic python dicts using rusqlite.
        // We will execute a JSON select to make it massively easier!
        let mut stmt2 = conn.prepare("SELECT json_object('id', id, 'event_id', event_id, 'hook_name', hook_name, 'url', url, 'secret', secret, 'headers', headers, 'payload', payload, 'attempt', attempt, 'next_retry_at', next_retry_at, 'status', status, 'created_at', created_at, 'updated_at', updated_at) FROM webhook_queue WHERE status = 'pending' ORDER BY created_at ASC").map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;

        let mut rows = stmt2
            .query([])
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;
        let json_mod = py.import_bound("json")?;

        let mut results = Vec::new();
        while let Ok(Some(row)) = rows.next() {
            let json_str: String = row.get(0).unwrap();
            let py_dict = json_mod.call_method1("loads", (json_str,))?;

            // Also parse headers inner JSON
            let headers_str: String = py_dict.get_item("headers")?.extract().unwrap_or_default();
            if !headers_str.is_empty() {
                let inner_headers = json_mod
                    .call_method1("loads", (headers_str,))
                    .unwrap_or(PyDict::new_bound(py).into_any());
                py_dict.set_item("headers", inner_headers)?;
            } else {
                py_dict.set_item("headers", PyDict::new_bound(py))?;
            }

            results.push(py_dict.into());
        }

        Ok(results)
    }

    pub fn fetch_dead_letters(&self, py: Python, limit: i64) -> PyResult<Vec<PyObject>> {
        if self.backend != "sqlite" {
            return Ok(vec![]);
        }
        let conn = Connection::open(&self.db_path)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;

        let mut stmt = conn.prepare("SELECT json_object('id', id, 'queue_id', queue_id, 'event_id', event_id, 'hook_name', hook_name, 'url', url, 'payload', payload, 'attempts', attempts, 'last_error', last_error, 'died_at', died_at) FROM webhook_dead_letter ORDER BY died_at DESC LIMIT ?1").map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;

        let mut rows = stmt
            .query([limit])
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;
        let json_mod = py.import_bound("json")?;

        let mut results = Vec::new();
        while let Ok(Some(row)) = rows.next() {
            let json_str: String = row.get(0).unwrap();
            let py_dict = json_mod.call_method1("loads", (json_str,))?;
            results.push(py_dict.into());
        }

        Ok(results)
    }

    pub fn pop_dead_letter(&self, py: Python, event_id: String) -> PyResult<Option<PyObject>> {
        if self.backend != "sqlite" {
            return Ok(None);
        }
        let mut conn = Connection::open(&self.db_path)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;
        let tx = conn
            .transaction()
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;

        let mut stmt = tx.prepare("SELECT json_object('id', id, 'queue_id', queue_id, 'event_id', event_id, 'hook_name', hook_name, 'url', url, 'payload', payload, 'attempts', attempts, 'last_error', last_error, 'died_at', died_at) FROM webhook_dead_letter WHERE event_id = ?1").map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;

        let mut rows = stmt
            .query(params![event_id])
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;
        let json_mod = py.import_bound("json")?;

        if let Ok(Some(row)) = rows.next() {
            let json_str: String = row.get(0).unwrap();
            let py_dict = json_mod.call_method1("loads", (json_str,))?;

            drop(rows);
            drop(stmt);
            let _ = tx.execute(
                "DELETE FROM webhook_dead_letter WHERE event_id = ?1",
                params![event_id],
            );
            let _ = tx.commit();
            return Ok(Some(py_dict.into()));
        }

        Ok(None)
    }

    pub fn close(&self) -> PyResult<()> {
        Ok(())
    }
}

#[pyfunction]
pub fn get_persistence(py: Python) -> PyResult<Option<PyObject>> {
    if let Some(p) = PERSISTENCE.get() {
        Ok(Some(p.clone_ref(py).into_any()))
    } else {
        Ok(None)
    }
}

#[pyfunction]
pub fn init_persistence(py: Python, db_path: String) -> PyResult<()> {
    let mut p = WebhookPersistence::new(db_path);
    p.init_db(py)?;
    let py_p = Py::new(py, p)?;
    let _ = PERSISTENCE.set(py_p);
    Ok(())
}

#[pyfunction]
pub fn close_persistence() -> PyResult<()> {
    // Cannot easily drop a static OnceLock in safe rust without Option, but close is a no-op anyway
    Ok(())
}

pub fn bind_persistence(_py: Python, m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<WebhookPersistence>()?;
    m.add_function(wrap_pyfunction!(get_persistence, m)?)?;
    m.add_function(wrap_pyfunction!(init_persistence, m)?)?;
    m.add_function(wrap_pyfunction!(close_persistence, m)?)?;
    Ok(())
}
