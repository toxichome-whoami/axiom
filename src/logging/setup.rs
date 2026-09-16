use crate::config::loader::ConfigManager;
use tracing_appender::rolling;
use tracing_subscriber::{
    fmt::{self, format::FmtSpan, format::FormatEvent, format::FormatFields, FmtContext, format::Writer},
    layer::SubscriberExt,
    util::SubscriberInitExt,
    EnvFilter, Registry,
};
use tracing::{Event, Subscriber, Level};
use tracing_subscriber::registry::LookupSpan;
use std::fmt::Result as FmtResult;

struct AxiomLogFormatter;

impl<S, N> FormatEvent<S, N> for AxiomLogFormatter
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
{
    fn format_event(
        &self,
        ctx: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &Event<'_>,
    ) -> FmtResult {
        let meta = event.metadata();
        
        let level = meta.level();
        let color = match *level {
            Level::TRACE => "\x1b[35m", // Magenta
            Level::DEBUG => "\x1b[36m", // Cyan
            Level::INFO  => "\x1b[32m", // Green
            Level::WARN  => "\x1b[33m", // Yellow
            Level::ERROR => "\x1b[31m\x1b[1m", // Bold Red
        };
        let reset = "\x1b[0m";
        let dim = "\x1b[2m";
        let bold = "\x1b[1m";

        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");

        write!(writer, "{dim}[{timestamp}]{reset} ")?;
        write!(writer, "{color}{bold}{:<5}{reset} ", level.as_str())?;
        
        write!(writer, "{dim}[{}]{reset} ", meta.target())?;
        
        ctx.format_fields(writer.by_ref(), event)?;
        writeln!(writer)
    }
}

pub fn setup_logging() -> std::result::Result<(), Box<dyn std::error::Error>> {
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
        let stdout_log = fmt::layer().event_format(AxiomLogFormatter);
        let file_log = fmt::layer().with_writer(non_blocking_file).with_ansi(false);

        let subscriber = Registry::default().with(env_filter).with(file_log);

        if config.logging.stdout {
            let _ = subscriber.with(stdout_log).try_init();
        } else {
            let _ = subscriber.try_init();
        }
    }

    std::mem::forget(_guard);

    Ok(())
}

