import time
from dataclasses import dataclass
from typing import Dict, List

import structlog

logger = structlog.get_logger()


@dataclass
class CircuitState:
    failures: int = 0
    opened_at: float = 0.0
    state: str = "closed"  # closed, open, half_open
    last_success: float = 0.0


class CircuitBreaker:
    def __init__(self):
        self._states: Dict[str, CircuitState] = {}

    def _get_state(self, url: str) -> CircuitState:
        if url not in self._states:
            self._states[url] = CircuitState()
        return self._states[url]

    def allow(self, url: str, recovery_secs: int) -> bool:
        st = self._get_state(url)
        if st.state == "closed":
            return True
        elif st.state == "open":
            if time.time() - st.opened_at > recovery_secs:
                st.state = "half_open"
                logger.info("Circuit transitioning to half-open for probe", url=url)
                return True
            return False
        elif st.state == "half_open":
            # Only allow one probe
            return False
        return True

    def record_success(self, url: str):
        st = self._get_state(url)
        if st.state != "closed":
            logger.info("Circuit closed (recovery successful)", url=url)
        st.failures = 0
        st.state = "closed"
        st.last_success = time.time()

    def record_failure(self, url: str, threshold: int):
        st = self._get_state(url)
        if st.state == "half_open":
            st.state = "open"
            st.opened_at = time.time()
            logger.warning("Circuit re-opened (probe failed)", url=url)
        else:
            st.failures += 1
            if st.failures >= threshold and st.state != "open":
                st.state = "open"
                st.opened_at = time.time()
                logger.error("Circuit opened", url=url, failures=st.failures)

    def get_state(self, url: str) -> dict:
        st = self._get_state(url)
        return {
            "state": st.state,
            "failures": st.failures,
            "opened_at": st.opened_at,
            "last_success": st.last_success,
        }

    def all_urls(self) -> List[str]:
        return list(self._states.keys())

    def reset(self, url: str):
        st = self._get_state(url)
        st.failures = 0
        st.state = "closed"
        st.opened_at = 0.0
        logger.info("Circuit manually reset", url=url)


_breaker = CircuitBreaker()


def get_circuit_breaker() -> CircuitBreaker:
    return _breaker
