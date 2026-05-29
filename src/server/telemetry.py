import os

import structlog
from fastapi import FastAPI
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import \
    OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import SERVICE_NAME, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

logger = structlog.get_logger()


def setup_telemetry(app: FastAPI):
    """Configures OpenTelemetry for Distributed Tracing."""
    try:
        from config.provider import GlobalConfigProvider

        config = GlobalConfigProvider().get_config()

        if not config.features.telemetry:
            return

        # 1. Always create a resource and tracer provider so we generate valid local trace IDs for logs
        resource = Resource(attributes={SERVICE_NAME: "axiom-gateway"})
        provider = TracerProvider(resource=resource)
        trace.set_tracer_provider(provider)

        # 2. Only attach an exporter if explicitly configured
        otlp_endpoint = config.telemetry.otlp_endpoint or os.environ.get(
            "OTEL_EXPORTER_OTLP_ENDPOINT"
        )
        if otlp_endpoint:
            # We use standard OTLP over HTTP (compatible with Jaeger, Datadog, Honeycomb)
            otlp_exporter = OTLPSpanExporter(endpoint=otlp_endpoint)
            processor = BatchSpanProcessor(otlp_exporter)
            provider.add_span_processor(processor)
            logger.info(
                "OpenTelemetry Distributed Tracing enabled", endpoint=otlp_endpoint
            )
        else:
            logger.info(
                "OpenTelemetry exporter disabled (otlp_endpoint not set). Local trace IDs will still be generated for logs."
            )

        # 3. Instrument FastAPI automatically so every request gets a span
        FastAPIInstrumentor.instrument_app(app)

    except Exception as e:
        logger.error("Failed to initialize OpenTelemetry", error=str(e))
        from config.provider import GlobalConfigProvider

        config = GlobalConfigProvider().get_config()
        config.features.telemetry = False
        logger.warning("Telemetry has been disabled due to initialization error.")
