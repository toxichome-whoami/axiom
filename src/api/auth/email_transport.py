import asyncio
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict

from src.api.auth.template_store import TemplateStore
from src.config.schema import AuthEmailConfig

DEFAULT_TEMPLATES = {
    "email_verify": {
        "subject": "Verify your email for {{.AppName}}",
        "html": '<p>Hi,</p><p>Please verify your email by clicking the link below:</p><p><a href="{{.Link}}">{{.Link}}</a></p>',
    },
    "email_verify_otp": {
        "subject": "Your verification code for {{.AppName}}",
        "html": "<p>Hi,</p><p>Your verification code is: <strong>{{.Code}}</strong></p>",
    },
    "password_reset": {
        "subject": "Reset your password for {{.AppName}}",
        "html": '<p>Hi,</p><p>Click the link below to reset your password:</p><p><a href="{{.Link}}">{{.Link}}</a></p>',
    },
    "magic_link": {
        "subject": "Log in to {{.AppName}}",
        "html": '<p>Hi,</p><p>Click the link below to log in:</p><p><a href="{{.Link}}">{{.Link}}</a></p>',
    },
    "email_change": {
        "subject": "Confirm your new email for {{.AppName}}",
        "html": '<p>Hi,</p><p>Click the link below to confirm this email address:</p><p><a href="{{.Link}}">{{.Link}}</a></p>',
    },
}


class EmailTransport:
    """Handles sending emails via SMTP asynchronously, using custom or default templates."""

    @staticmethod
    def _send_sync(
        email_config: AuthEmailConfig, to_email: str, subject: str, html_body: str
    ) -> None:
        """Synchronous SMTP send, to be run in a thread pool."""
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{email_config.from_name} <{email_config.from_address}>"
        msg["To"] = to_email

        part = MIMEText(html_body, "html")
        msg.attach(part)

        # Connect to SMTP securely based on port
        if email_config.smtp_port == 465:
            server = smtplib.SMTP_SSL(email_config.smtp_host, email_config.smtp_port)
        else:
            server = smtplib.SMTP(email_config.smtp_host, email_config.smtp_port)
            if email_config.smtp_tls:
                server.starttls()

        try:
            if email_config.smtp_user and email_config.smtp_password:
                server.login(email_config.smtp_user, email_config.smtp_password)
            server.send_message(msg)
        finally:
            server.quit()

    @staticmethod
    async def send_email(
        conn: Any,
        email_config: AuthEmailConfig,
        template_type: str,
        to_email: str,
        placeholders: Dict[str, Any],
    ) -> None:
        """Loads template, injects variables, and sends email asynchronously."""

        # Load template from DB
        row = await TemplateStore.get_template(conn, template_type)
        if row:
            subject_tmpl = row["subject"]
            html_tmpl = row["html"]
        else:
            # Fallback to default
            defaults = DEFAULT_TEMPLATES.get(template_type)
            if not defaults:
                return
            subject_tmpl = defaults["subject"]
            html_tmpl = defaults["html"]

        # Ensure universal placeholders
        placeholders["{{.AppName}}"] = email_config.from_name
        placeholders["{{.UserEmail}}"] = to_email

        # Inject variables
        subject = subject_tmpl
        html = html_tmpl
        for k, v in placeholders.items():
            subject = subject.replace(k, str(v))
            html = html.replace(k, str(v))

        # Send via thread pool
        await asyncio.to_thread(
            EmailTransport._send_sync, email_config, to_email, subject, html
        )
