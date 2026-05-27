import uuid
from typing import Any, Dict, Optional

from src.config.schema import AuthProjectConfig
from src.webhook.emitter import WebhookTrigger, emit_event


class AuthWebhookEmitter:
    """Emits auth events to the global Axiom webhook dispatcher."""

    @staticmethod
    async def emit(
        config: AuthProjectConfig,
        project_id: str,
        event_name: str,
        uid: str,
        email: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Emits an event if configured to do so."""
        # Check config
        enabled = False
        if event_name == "signup" and config.webhook_on_signup:
            enabled = True
        elif event_name == "login" and config.webhook_on_login:
            enabled = True
        elif event_name == "logout" and config.webhook_on_logout:
            enabled = True
        elif event_name == "password_reset" and config.webhook_on_password_reset:
            enabled = True
        elif event_name == "email_change" and config.webhook_on_email_change:
            enabled = True
        elif event_name == "account_deleted" and config.webhook_on_delete:
            enabled = True

        if not enabled:
            return

        details = {
            "uid": uid,
            "email": email,
            "ip_address": ip_address,
            "user_agent": user_agent,
            "metadata": metadata or {},
            "project": project_id,
        }

        # Create a dummy trigger for system events
        trigger = WebhookTrigger(
            api_key=project_id, ip=ip_address, request_id=f"req_{uuid.uuid4().hex}"
        )

        await emit_event(
            module="auth",
            operation=event_name,
            resource="user",
            target=uid,
            action=event_name.upper(),
            details=details,
            trigger=trigger,
        )
