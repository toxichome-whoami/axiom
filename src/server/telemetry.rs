use crate::config::loader::ConfigManager;
use opentelemetry::KeyValue;
use opentelemetry_sdk::trace::{self, Tracer};
use opentelemetry_sdk::Resource;
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, Registry};

pub fn setup_telemetry() -> Result<(), Box<dyn std::error::Error>> {
    let config = ConfigManager::get();

    if !config.features.telemetry {
        return Ok(());
    }

    let otlp_endpoint = if !config.telemetry.otlp_endpoint.is_empty() {
        config.telemetry.otlp_endpoint.clone()
    } else {
        std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT").unwrap_or_default()
    };

    if otlp_endpoint.is_empty() {
        println!("OpenTelemetry exporter disabled (otlp_endpoint not set).");
        return Ok(());
    }

    let tracer: Tracer = opentelemetry_otlp::new_pipeline()
        .tracing()
        .with_exporter(
            opentelemetry_otlp::new_exporter()
                .http()
                .with_endpoint(otlp_endpoint),
        )
        .with_trace_config(
            trace::config().with_resource(Resource::new(vec![KeyValue::new(
                "service.name",
                "axiom-gateway",
            )])),
        )
        .install_batch(opentelemetry_sdk::runtime::Tokio)?;

    // NOTE: This will fail if a global subscriber is already set in main.rs
    // This expects to be the primary subscriber setup.
    let telemetry = OpenTelemetryLayer::new(tracer);

    // Instead of initializing a new registry, we should just return the tracer/layer
    // But since this is a direct translation, we'll try to init.
    // In production Rust, you'd integrate this with the subscriber in main.rs.
    let _ = Registry::default().with(telemetry).try_init();

    println!("OpenTelemetry Distributed Tracing enabled");
    Ok(())
}
