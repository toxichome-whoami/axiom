import asyncio
import json
import uuid
from typing import Any, Dict, List, Optional

import structlog

from src.api.auth.user_store import auth_db_manager, utc_now_iso

logger = structlog.get_logger()


class AuthImportExport:
    """Handles bulk importing and exporting of users."""

    @staticmethod
    async def start_import_job(project_id: str, users: List[Dict[str, Any]]) -> str:
        job_id = str(uuid.uuid4())
        now = utc_now_iso()
        conn = await auth_db_manager.get_db(project_id)

        await conn.execute(
            """
            INSERT INTO import_jobs (id, status, total, created_at)
            VALUES (?, 'pending', ?, ?)
            """,
            (job_id, len(users), now),
        )
        await conn.commit()

        # Start background task
        asyncio.create_task(AuthImportExport._run_import_job(project_id, job_id, users))

        return job_id

    @staticmethod
    async def _run_import_job(
        project_id: str, job_id: str, users: List[Dict[str, Any]]
    ) -> None:
        try:
            conn = await auth_db_manager.get_db(project_id)
            await conn.execute(
                "UPDATE import_jobs SET status = 'running' WHERE id = ?", (job_id,)
            )
            await conn.commit()

            succeeded = 0
            failed = 0
            errors = []

            for user in users:
                try:
                    uid = user.get("uid") or str(
                        uuid.uuid7() if hasattr(uuid, "uuid7") else uuid.uuid4()
                    )
                    email = user.get("email")
                    password_hash = user.get("password_hash")
                    display_name = user.get("display_name", "")
                    avatar_url = user.get("avatar_url", "")
                    email_verified = 1 if user.get("email_verified") else 0
                    disabled = 1 if user.get("disabled") else 0
                    metadata = user.get("metadata", {})
                    created_at = user.get("created_at") or utc_now_iso()

                    await conn.execute(
                        """
                        INSERT INTO users (uid, email, password_hash, display_name, avatar_url, email_verified, disabled, created_at, updated_at, metadata)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            uid,
                            email.lower() if email else None,
                            password_hash,
                            display_name,
                            avatar_url,
                            email_verified,
                            disabled,
                            created_at,
                            created_at,
                            json.dumps(metadata),
                        ),
                    )

                    # Log audit event
                    await conn.execute(
                        """
                        INSERT INTO auth_audit (uid, event, created_at)
                        VALUES (?, 'import_user', ?)
                        """,
                        (uid, utc_now_iso()),
                    )

                    succeeded += 1
                except Exception as e:
                    failed += 1
                    errors.append({"email": user.get("email"), "error": str(e)})

            await conn.execute(
                """
                UPDATE import_jobs
                SET status = 'done', succeeded = ?, failed = ?, errors = ?, completed_at = ?
                WHERE id = ?
                """,
                (succeeded, failed, json.dumps(errors), utc_now_iso(), job_id),
            )
            await conn.commit()

            logger.info(
                "Import job completed",
                project=project_id,
                job_id=job_id,
                succeeded=succeeded,
                failed=failed,
            )

        except Exception as e:
            logger.error(
                "Import job crashed", project=project_id, job_id=job_id, error=str(e)
            )
            conn = await auth_db_manager.get_db(project_id)
            await conn.execute(
                "UPDATE import_jobs SET status = 'failed', errors = ? WHERE id = ?",
                (json.dumps([str(e)]), job_id),
            )
            await conn.commit()

    @staticmethod
    async def get_import_job(project_id: str, job_id: str) -> Optional[Dict[str, Any]]:
        conn = await auth_db_manager.get_db(project_id)
        async with conn.execute(
            "SELECT * FROM import_jobs WHERE id = ?", (job_id,)
        ) as cursor:
            row = await cursor.fetchone()
            if row:
                d = dict(row)
                d["errors"] = json.loads(d["errors"])
                return d
            return None

    @staticmethod
    async def export_users(project_id: str) -> List[Dict[str, Any]]:
        conn = await auth_db_manager.get_db(project_id)
        users = []
        async with conn.execute("SELECT * FROM users") as cursor:
            async for row in cursor:
                user = dict(row)
                if user["metadata"]:
                    user["metadata"] = json.loads(user["metadata"])
                users.append(user)
        return users
