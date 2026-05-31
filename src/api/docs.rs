use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    paths(
        crate::api::core::health::root,
        crate::api::core::health::ready,
        crate::api::core::health::health,
    ),
    info(
        title = "Axiom API Gateway",
        version = "1.0.5",
        description = "Industrial-Grade Unified API Gateway"
    )
)]
pub struct ApiDoc;
