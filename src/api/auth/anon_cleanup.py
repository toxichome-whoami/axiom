import asyncio

import structlog

from src.api.auth.user_store import auth_db_manager, utc_now_iso
from src.config.provider import GlobalConfigProvider

logger = structlog.get_logger()


async def cleanup_expired_anonymous_users() -> None:
    """Background task to delete expired anonymous accounts."""
    while True:
        try:
            config = GlobalConfigProvider().get_config()
            if not config.features.auth:
                await asyncio.sleep(3600)
                continue

            now = utc_now_iso()

            # Iterate through all configured auth projects
            for api_key_name, project_config in config.auth.project.items():
                if not project_config.anonymous_auth:
                    continue

                try:
                    conn = await auth_db_manager.get_db(api_key_name)
                    # Delete users where is_anonymous=1 and anonymous_expires_at < now
                    # ON DELETE CASCADE handles refresh_tokens, auth_tokens, totp_backup_codes
                    async with conn.execute(
                        "DELETE FROM users WHERE is_anonymous = 1 AND anonymous_expires_at < ?",
                        (now,),
                    ) as cursor:
                        deleted = cursor.rowcount
                        if deleted > 0:
                            logger.info(
                                "Cleaned up expired anonymous accounts",
                                project=api_key_name,
                                count=deleted,
                            )
                            await conn.commit()
                except Exception as e:
                    logger.error(
                        "Failed to cleanup anonymous accounts",
                        project=api_key_name,
                        error=str(e),
                    )

        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error("Error in anonymous cleanup daemon", error=str(e))

        # Run every hour
        await asyncio.sleep(3600)
