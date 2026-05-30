use dashmap::DashMap;
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, PartialEq, Eq)]
pub enum State {
    Closed,
    Open,
    HalfOpen,
}

impl State {
    pub fn as_str(&self) -> &'static str {
        match self {
            State::Closed => "closed",
            State::Open => "open",
            State::HalfOpen => "half_open",
        }
    }
}

#[derive(Clone)]
pub struct CircuitState {
    pub failures: u32,
    pub opened_at: f64,
    pub state: State,
    pub last_success: f64,
}

impl Default for CircuitState {
    fn default() -> Self {
        Self {
            failures: 0,
            opened_at: 0.0,
            state: State::Closed,
            last_success: 0.0,
        }
    }
}

fn current_time() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs_f64()
}

/// A high-performance, thread-safe Circuit Breaker implemented in Rust.
/// Uses DashMap for lock-free concurrency across all Python threads.
#[derive(Clone)]
pub struct CircuitBreaker {
    states: Arc<DashMap<String, CircuitState>>,
}

impl CircuitBreaker {
    pub fn new() -> Self {
        CircuitBreaker {
            states: Arc::new(DashMap::new()),
        }
    }

    pub fn allow(&self, url: &str, recovery_secs: f64) -> bool {
        let mut st = self
            .states
            .entry(url.to_string())
            .or_insert_with(CircuitState::default);

        match st.state {
            State::Closed => true,
            State::Open => {
                if current_time() - st.opened_at > recovery_secs {
                    st.state = State::HalfOpen;
                    true
                } else {
                    false
                }
            }
            State::HalfOpen => false,
        }
    }

    pub fn record_success(&self, url: &str) {
        let mut st = self
            .states
            .entry(url.to_string())
            .or_insert_with(CircuitState::default);
        st.failures = 0;
        st.state = State::Closed;
        st.last_success = current_time();
    }

    pub fn record_failure(&self, url: &str, threshold: u32) {
        let mut st = self
            .states
            .entry(url.to_string())
            .or_insert_with(CircuitState::default);

        if st.state == State::HalfOpen {
            st.state = State::Open;
            st.opened_at = current_time();
        } else {
            st.failures += 1;
            if st.failures >= threshold && st.state != State::Open {
                st.state = State::Open;
                st.opened_at = current_time();
            }
        }
    }

    pub fn get_state(&self, url: &str) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        let st = self
            .states
            .entry(url.to_string())
            .or_insert_with(CircuitState::default);

        Ok(serde_json::json!({
            "state": st.state.as_str(),
            "failures": st.failures,
            "opened_at": st.opened_at,
            "last_success": st.last_success,
        }))
    }

    pub fn all_urls(&self) -> Vec<String> {
        self.states.iter().map(|kv| kv.key().clone()).collect()
    }

    pub fn reset(&self, url: &str) {
        let mut st = self
            .states
            .entry(url.to_string())
            .or_insert_with(CircuitState::default);
        st.failures = 0;
        st.state = State::Closed;
        st.opened_at = 0.0;
    }
}

static BREAKER: OnceLock<CircuitBreaker> = OnceLock::new();

pub fn get_circuit_breaker() -> CircuitBreaker {
    BREAKER.get_or_init(|| CircuitBreaker::new()).clone()
}
