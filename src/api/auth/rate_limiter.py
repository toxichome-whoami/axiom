import time

from cachetools import TTLCache

from src.api.errors import AxiomException, ErrorCodes
from src.config.schema import AuthProjectConfig


class AuthRateLimiter:
    """In-memory rate limiting specific to auth operations."""

    def __init__(self):
        # 1-hour TTL for IP signup tracking, max 100,000 IPs
        self.ip_signups = TTLCache(maxsize=100000, ttl=3600)
        # Lockout tracking (dynamic TTL based on project config), max 100,000 locks
        self.email_login_failures = TTLCache(maxsize=100000, ttl=3600)
        self.lockouts = TTLCache(
            maxsize=100000, ttl=86400
        )  # Up to 24 hours just in case

    def check_ip_signup(self, ip: str, config: AuthProjectConfig) -> None:
        """Enforces max_signup_per_ip per hour."""
        count = self.ip_signups.get(ip, 0)
        if count >= config.max_signup_per_ip:
            raise AxiomException(
                code=ErrorCodes.AUTH_RATE_LIMITED,
                message="Too many signups from this IP. Please try again later.",
                status_code=429,
            )

    def record_ip_signup(self, ip: str) -> None:
        count = self.ip_signups.get(ip, 0)
        self.ip_signups[ip] = count + 1

    def check_login_lockout(self, email: str, config: AuthProjectConfig) -> None:
        """Checks if an email is currently locked out from too many failed attempts."""
        if email in self.lockouts:
            raise AxiomException(
                code=ErrorCodes.AUTH_RATE_LIMITED,
                message="Too many failed login attempts. Account temporarily locked.",
                status_code=429,
            )

    def record_failed_login(self, email: str, config: AuthProjectConfig) -> None:
        """Records a failed login and triggers lockout if max attempts reached."""
        count = self.email_login_failures.get(email, 0) + 1
        self.email_login_failures[email] = count

        if count >= config.max_login_attempts:
            # Trigger lockout
            self.lockouts[email] = time.time() + config.lockout_duration
            # Reset failures so it requires fresh attempts after lockout
            del self.email_login_failures[email]

            raise AxiomException(
                code=ErrorCodes.AUTH_RATE_LIMITED,
                message="Too many failed login attempts. Account temporarily locked.",
                status_code=429,
            )

    def record_successful_login(self, email: str) -> None:
        """Clears failed attempts on successful login."""
        if email in self.email_login_failures:
            del self.email_login_failures[email]


auth_rate_limiter = AuthRateLimiter()
