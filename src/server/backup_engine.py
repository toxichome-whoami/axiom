import asyncio
import os
import tarfile
import tempfile
from datetime import datetime

import boto3
import structlog

from config.provider import GlobalConfigProvider

logger = structlog.get_logger()


class BackupEngine:
    """Automated Disaster Recovery Engine for Point-in-Time Recovery (PITR)"""

    def __init__(self):
        self.running = False
        self._task = None
        self.data_dir = "./data"

    def start(self):
        """Starts the background backup daemon."""
        config = GlobalConfigProvider().get_config()
        if not hasattr(config, "backups") or not config.backups.enabled:
            logger.info("Automated backups disabled via config.toml")
            return

        self.running = True
        self._task = asyncio.create_task(self._backup_loop())
        logger.info(
            "Backup Engine started", interval_minutes=config.backups.interval_minutes
        )

    async def stop(self):
        """Gracefully stops the backup daemon."""
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Backup Engine stopped")

    async def _backup_loop(self):
        while self.running:
            config = GlobalConfigProvider().get_config()
            interval = config.backups.interval_minutes * 60

            try:
                # Wait for the interval in small increments to allow responsive shutdown
                slept = 0
                while slept < interval and self.running:
                    await asyncio.sleep(1)
                    slept += 1

                if not self.running:
                    break

                await self._execute_backup(config.backups)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Backup Engine encountered fatal error", error=str(e))
                await asyncio.sleep(60)  # Wait before retry

    async def _execute_backup(self, backup_config):
        """Compresses the data directory and uploads to S3."""
        if not os.path.exists(self.data_dir):
            logger.warning("Backup skipped: Data directory does not exist", path=self.data_dir)
            return

        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        archive_name = f"axiom_backup_{timestamp}.tar.gz"
        tmp_dir = tempfile.gettempdir()
        archive_path = os.path.join(tmp_dir, archive_name)

        try:
            logger.info("Starting automated PITR backup...", dest=archive_path)

            # 1. Compress data directory
            def make_tarfile():
                with tarfile.open(archive_path, "w:gz") as tar:
                    tar.add(self.data_dir, arcname=os.path.basename(self.data_dir))

            await asyncio.to_thread(make_tarfile)

            # 2. Upload to S3
            if not backup_config.s3_access_key or not backup_config.s3_secret_key:
                logger.warning("Backup S3 credentials missing. Skipping upload.")
                return

            client_args = {
                "service_name": "s3",
                "region_name": backup_config.s3_region,
                "aws_access_key_id": backup_config.s3_access_key,
                "aws_secret_access_key": backup_config.s3_secret_key,
            }
            if backup_config.s3_endpoint_url:
                client_args["endpoint_url"] = backup_config.s3_endpoint_url

            def upload():
                s3_client = boto3.client(**client_args)
                s3_client.upload_file(
                    archive_path, backup_config.s3_bucket, archive_name
                )

            await asyncio.to_thread(upload)
            logger.info(
                "Backup uploaded to S3 successfully",
                archive=archive_name,
                bucket=backup_config.s3_bucket,
            )

        except Exception as e:
            logger.error("Failed to execute S3 backup", error=str(e))
        finally:
            if os.path.exists(archive_path):
                try:
                    os.remove(archive_path)
                except Exception as ex:
                    logger.warning("Failed to clean up temp backup archive", error=str(ex))


backup_engine = BackupEngine()
