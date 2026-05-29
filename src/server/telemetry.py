import structlog
from fastapi import FastAPI
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import SERVICE_NAME, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

logger = structlog.get_logger()


def setup_telemetry(app: FastAPI):
    """Configures OpenTelemetry for Distributed Tracing."""
    try:
        # Create resource identifying the service
        resource = Resource(attributes={SERVICE_NAME: "axiom-gateway"})

        provider = TracerProvider(resource=resource)

        # We use standard OTLP over HTTP (compatible with Jaeger, Datadog, Honeycomb)
        otlp_exporter = OTLPSpanExporter(
            endpoint="http://localhost:4318/v1/traces"  # Default OTLP receiver
        )

        processor = BatchSpanProcessor(otlp_exporter)
        provider.add_span_processor(processor)

        # Set global tracer provider
        trace.set_tracer_provider(provider)

        # Instrument FastAPI automatically
        FastAPIInstrumentor.instrument_app(app)

        logger.info("OpenTelemetry Distributed Tracing enabled")

    except Exception as e:
        logger.error("Failed to initialize OpenTelemetry", error=str(e))
