import time

from cachetools import TTLCache

from src.api.errors import AxiomException, ErrorCodes

# Global in-memory cache for tracking brute force attempts.
# Keys are format: "{action}:{project_id}:{ip_address}"
# Values are lists of timestamps when attempts occurred.
# TTL is set to the maximum expected lockout window (e.g. 1 hour = 3600s)
_brute_force_cache = TTLCache(maxsize=10000, ttl=3600)


class BruteForceProtector:
    @staticmethod
    def check_and_record(
        action: str,
        project_id: str,
        ip_address: str,
        max_attempts: int,
        window_seconds: int,
        lockout_duration: int,
    ) -> None:
        """
        Check if the IP has exceeded the max attempts for the given action.
        If not, record the attempt. If exceeded, raise a 429 Too Many Requests.
        """
        if max_attempts <= 0:
            return  # Protection disabled

        key = f"{action}:{project_id}:{ip_address}"
        now = time.time()

        # Get existing attempts
        attempts = _brute_force_cache.get(key, [])

        # Check if currently locked out
        if len(attempts) >= max_attempts:
            last_attempt = attempts[-1]
            if now - last_attempt < lockout_duration:
                # User is locked out
                remaining = int(lockout_duration - (now - last_attempt))
                raise AxiomException(
                    ErrorCodes.RATE_LIMIT_EXCEEDED,
                    f"Too many attempts. Please try again in {remaining} seconds.",
                    429,
                )
            else:
                # Lockout expired, reset attempts
                attempts = []

        # Filter attempts within the current rolling window
        valid_attempts = [t for t in attempts if now - t < window_seconds]

        # Check if adding this attempt exceeds the limit
        if len(valid_attempts) >= max_attempts:
            # We just hit the limit, record it and lock out
            valid_attempts.append(now)
            _brute_force_cache[key] = valid_attempts
            raise AxiomException(
                ErrorCodes.RATE_LIMIT_EXCEEDED,
                f"Too many attempts. Account locked for {lockout_duration} seconds.",
                429,
            )

        # Record the attempt
        valid_attempts.append(now)
        _brute_force_cache[key] = valid_attempts

    @staticmethod
    def reset(action: str, project_id: str, ip_address: str) -> None:
        """Clear attempts upon successful action (e.g., successful login)."""
        key = f"{action}:{project_id}:{ip_address}"
        _brute_force_cache.pop(key, None)
