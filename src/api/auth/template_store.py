import re
from typing import Dict, List, Optional

import aiosqlite

from src.api.auth.user_store import utc_now_iso
from src.api.errors import AxiomException, ErrorCodes

VALID_TEMPLATES = {
    "email_verify",
    "email_verify_otp",
    "password_reset",
    "magic_link",
    "email_change",
    "new_device_login",
}

ALLOWED_PLACEHOLDERS = {
    "email_verify": {"{{.AppName}}", "{{.UserEmail}}", "{{.Link}}"},
    "email_verify_otp": {"{{.AppName}}", "{{.UserEmail}}", "{{.Code}}"},
    "password_reset": {"{{.AppName}}", "{{.UserEmail}}", "{{.Link}}"},
    "magic_link": {"{{.AppName}}", "{{.UserEmail}}", "{{.Link}}"},
    "email_change": {"{{.AppName}}", "{{.UserEmail}}", "{{.Link}}"},
    "new_device_login": {
        "{{.AppName}}",
        "{{.UserEmail}}",
        "{{.IpAddress}}",
        "{{.UserAgent}}",
        "{{.Time}}",
    },
}

# Regex to find any placeholder in the form {{...}}
PLACEHOLDER_REGEX = re.compile(r"\{\{[^}]+\}\}")


class TemplateStore:
    """Manages custom HTML email templates in auth.db."""

    @staticmethod
    def validate_html(template_type: str, html: str) -> None:
        """Ensures all placeholders in the HTML are valid for the given template type."""
        if template_type not in VALID_TEMPLATES:
            raise AxiomException(
                code=ErrorCodes.INPUT_VALUE_INVALID,
                message=f"Invalid template type: {template_type}",
                status_code=400,
            )

        found_placeholders = set(PLACEHOLDER_REGEX.findall(html))
        allowed = ALLOWED_PLACEHOLDERS[template_type]

        invalid = found_placeholders - allowed
        if invalid:
            raise AxiomException(
                code=ErrorCodes.INPUT_VALUE_INVALID,
                message=f"Invalid placeholders found for {template_type}: {', '.join(invalid)}. Allowed: {', '.join(allowed)}",
                status_code=400,
            )

    @staticmethod
    async def get_template(
        conn: aiosqlite.Connection, template_type: str
    ) -> Optional[aiosqlite.Row]:
        async with conn.execute(
            "SELECT subject, html FROM email_templates WHERE type = ?", (template_type,)
        ) as cursor:
            return await cursor.fetchone()

    @staticmethod
    async def set_template(
        conn: aiosqlite.Connection, template_type: str, subject: str, html: str
    ) -> None:
        TemplateStore.validate_html(template_type, html)
        await conn.execute(
            """
            INSERT INTO email_templates (type, subject, html, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(type) DO UPDATE SET subject=excluded.subject, html=excluded.html, updated_at=excluded.updated_at
            """,
            (template_type, subject, html, utc_now_iso()),
        )

    @staticmethod
    async def delete_template(conn: aiosqlite.Connection, template_type: str) -> None:
        await conn.execute(
            "DELETE FROM email_templates WHERE type = ?", (template_type,)
        )

    @staticmethod
    async def list_templates(conn: aiosqlite.Connection) -> List[Dict[str, str]]:
        async with conn.execute(
            "SELECT type, subject, updated_at FROM email_templates"
        ) as cursor:
            rows = await cursor.fetchall()
            return [
                {
                    "type": r["type"],
                    "subject": r["subject"],
                    "updated_at": r["updated_at"],
                }
                for r in rows
            ]
