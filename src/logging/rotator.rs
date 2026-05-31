use crate::config::loader::ConfigManager;
use std::fs;
use std::path::Path;
use std::time::Duration;
use tokio::time::sleep;

pub struct LogRotator;

impl LogRotator {
    pub fn start() -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            loop {
                let config = ConfigManager::get();
                if !config.logging.enabled {
                    break;
                }

                sleep(Duration::from_secs(60)).await;
                Self::garbage_collect(
                    &config.logging.directory,
                    &config.logging.file_prefix,
                    config.logging.max_files as usize,
                );
            }
        })
    }

    fn garbage_collect(directory: &str, prefix: &str, max_files: usize) {
        let dir_path = Path::new(directory);
        if !dir_path.exists() {
            return;
        }

        let mut logs = vec![];
        if let Ok(entries) = fs::read_dir(dir_path) {
            for entry in entries.flatten() {
                if let Ok(name) = entry.file_name().into_string() {
                    if name.starts_with(prefix) && name.ends_with(".log") {
                        if let Ok(metadata) = entry.metadata() {
                            if let Ok(modified) = metadata.modified() {
                                logs.push((entry.path(), modified));
                            }
                        }
                    }
                }
            }
        }

        if logs.len() <= max_files {
            return;
        }

        logs.sort_by(|a, b| a.1.cmp(&b.1)); // Oldest first

        let to_delete = logs.len() - max_files;
        for i in 0..to_delete {
            let _ = fs::remove_file(&logs[i].0);
        }
    }
}
