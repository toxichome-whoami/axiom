use crate::config::loader::ConfigManager;
use tracing_appender::rolling;
use tracing_subscriber::{
    fmt::{self, format::FmtSpan},
    layer::SubscriberExt,
    util::SubscriberInitExt,
    EnvFilter, Registry,
};

pub fn setup_logging() -> Result<(), Box<dyn std::error::Error>> {
    let config = ConfigManager::get();

    if !config.logging.enabled {
        return Ok(());
    }

    let log_level = match config.logging.level.to_uppercase().as_str() {
        "TRACE" => "trace",
        "DEBUG" => "debug",
        "INFO" => "info",
        "WARN" => "warn",
        "ERROR" => "error",
        _ => "info",
    };

    let env_filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(log_level));

    let file_appender = rolling::daily(&config.logging.directory, &config.logging.file_prefix);
    let (non_blocking_file, _guard) = tracing_appender::non_blocking(file_appender);

    let format_json = config.logging.format == "json";

    if format_json {
        let stdout_log = fmt::layer().json().with_span_events(FmtSpan::CLOSE);
        let file_log = fmt::layer().json().with_writer(non_blocking_file);

        let subscriber = Registry::default().with(env_filter).with(file_log);

        if config.logging.stdout {
            let _ = subscriber.with(stdout_log).try_init();
        } else {
            let _ = subscriber.try_init();
        }
    } else {
        let stdout_log = fmt::layer().with_span_events(FmtSpan::CLOSE);
        let file_log = fmt::layer().with_writer(non_blocking_file).with_ansi(false);

        let subscriber = Registry::default().with(env_filter).with(file_log);

        if config.logging.stdout {
            let _ = subscriber.with(stdout_log).try_init();
        } else {
            let _ = subscriber.try_init();
        }
    }

    // NOTE: The `_guard` will be dropped here, which flushes non_blocking_file.
    // In a real app we need to return the WorkerGuard so it stays alive,
    // but we can leak it for now to match the simplicity.
    std::mem::forget(_guard);

    Ok(())
}
