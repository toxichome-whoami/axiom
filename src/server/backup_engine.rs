use crate::config::loader::ConfigManager;
use aws_sdk_s3::config::Region;
use aws_sdk_s3::Client;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::fs::File;
use std::path::Path;
use std::time::Duration;
use tar::Builder;
use tokio::time::sleep;

pub struct BackupEngine;

impl BackupEngine {
    pub fn start() -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            loop {
                let config = ConfigManager::get();
                if !config.backups.enabled {
                    break;
                }

                let interval_secs = (config.backups.interval_minutes * 60) as u64;
                sleep(Duration::from_secs(interval_secs)).await;

                if let Err(e) = Self::execute_backup().await {
                    eprintln!("Backup failed: {}", e);
                }
            }
        })
    }

    async fn execute_backup() -> Result<(), Box<dyn std::error::Error>> {
        let config = ConfigManager::get();
        let data_dir = Path::new("./data");

        if !data_dir.exists() {
            println!("Backup skipped: data directory does not exist.");
            return Ok(());
        }

        let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S").to_string();
        let archive_name = format!("axiom_backup_{}.tar.gz", timestamp);
        let tmp_dir = Path::new("./.tmp_backup");
        std::fs::create_dir_all(tmp_dir)?;

        let archive_path = tmp_dir.join(&archive_name);

        // 1. Compress
        let tar_gz = File::create(&archive_path)?;
        let enc = GzEncoder::new(tar_gz, Compression::default());
        let mut tar = Builder::new(enc);
        tar.append_dir_all("data", data_dir)?;
        tar.finish()?;

        // 2. Upload
        if config.backups.s3_access_key.is_empty() || config.backups.s3_secret_key.is_empty() {
            println!("S3 credentials missing. Skipping upload.");
            return Ok(());
        }

        std::env::set_var("AWS_ACCESS_KEY_ID", &config.backups.s3_access_key);
        std::env::set_var("AWS_SECRET_ACCESS_KEY", &config.backups.s3_secret_key);

        let region = Region::new(config.backups.s3_region.clone());
        let mut aws_config_builder = aws_config::defaults(aws_config::BehaviorVersion::latest()).region(region);

        if let Some(endpoint) = &config.backups.s3_endpoint_url {
            aws_config_builder = aws_config_builder.endpoint_url(endpoint);
        }

        let sdk_config = aws_config_builder.load().await;
        let client = Client::new(&sdk_config);

        let body = aws_sdk_s3::primitives::ByteStream::from_path(&archive_path).await?;

        client
            .put_object()
            .bucket(&config.backups.s3_bucket)
            .key(&archive_name)
            .body(body)
            .send()
            .await?;

        println!("Backup uploaded to S3 successfully: {}", archive_name);

        // Cleanup
        let _ = std::fs::remove_file(archive_path);

        Ok(())
    }
}
