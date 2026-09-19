//! Loopback-only Devin Connect gateway.
//!
//! This listener is intentionally separate from the Cursor listener. It is
//! disabled by default and only reads the persisted Devin binding table when
//! it is explicitly enabled.

use std::{collections::HashSet, future::IntoFuture, net::SocketAddr, sync::Arc};

use axum::{
    body::{to_bytes, Body},
    extract::{Request, State},
    http::{header, HeaderMap, Method, Response, StatusCode},
    response::IntoResponse,
    routing::{any, get},
    Router,
};
use bytes::Bytes;
use futures_util::StreamExt;
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;

use crate::{
    provider::{ModelEvent, Provider},
    store::Store,
    Error, Result,
};

use super::{
    assignment::{assignment_token_response, find_model_reference, AssignmentSessions},
    catalog,
    request::{parse_chat_request, to_invocation},
    response::{finish, stream_event, ResponseState},
    wire::{self, ConnectError, MAX_BODY_SIZE},
};

const TOKEN_HEADER: &str = "x-devin-router-token";

#[derive(Clone)]
pub struct DevinGateway {
    store: Store,
    provider: Arc<dyn Provider>,
}

#[derive(Clone)]
struct GatewayState {
    store: Store,
    provider: Arc<dyn Provider>,
    assignments: Arc<AssignmentSessions>,
}

impl DevinGateway {
    pub fn new(store: Store, provider: Arc<dyn Provider>) -> Self {
        Self { store, provider }
    }

    pub async fn serve(self, shutdown: CancellationToken) -> Result<()> {
        let settings = self.store.devin_settings().await?;
        if !settings.enabled {
            tracing::debug!("Devin gateway is disabled; no Devin ports will be opened");
            shutdown.cancelled().await;
            return Ok(());
        }

        let state = GatewayState {
            store: self.store,
            provider: self.provider,
            assignments: Arc::new(AssignmentSessions::new()),
        };
        let router = Router::new()
            .route("/health", get(health))
            .fallback(any(handle_request))
            .with_state(state);

        let api_listener = bind(settings.api_port).await?;
        let inference_listener = bind(settings.inference_port).await?;
        let local_listener = bind(settings.local_api_port).await?;
        tracing::info!(
            api_port = settings.api_port,
            inference_port = settings.inference_port,
            local_api_port = settings.local_api_port,
            "Devin gateway listening on loopback"
        );

        let api = axum::serve(api_listener, router.clone()).into_future();
        let inference = axum::serve(inference_listener, router.clone()).into_future();
        let local = axum::serve(local_listener, router).into_future();
        tokio::pin!(api, inference, local);
        tokio::select! {
            result = &mut api => result.map_err(Error::Io),
            result = &mut inference => result.map_err(Error::Io),
            result = &mut local => result.map_err(Error::Io),
            _ = shutdown.cancelled() => Ok(()),
        }
    }
}

async fn bind(port: u16) -> Result<TcpListener> {
    TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port)))
        .await
        .map_err(Error::Io)
}

async fn health() -> impl IntoResponse {
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        r#"{"ok":true,"service":"devin"}"#,
    )
}

async fn handle_request(
    State(state): State<GatewayState>,
    request: Request<Body>,
) -> Response<Body> {
    let (parts, body) = request.into_parts();
    if parts.method != Method::POST {
        return plain_error(
            StatusCode::METHOD_NOT_ALLOWED,
            "Devin gateway accepts POST only",
        );
    }
    let method = parts.uri.path().rsplit('/').next().unwrap_or_default();
    if !matches!(
        method,
        "GetChatMessage" | "GetCliModelConfigs" | "AssignModel"
    ) {
        return plain_error(StatusCode::NOT_FOUND, "unsupported Devin RPC method");
    }

    let settings = match state.store.devin_settings().await {
        Ok(settings) => settings,
        Err(error) => return protocol_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
    };
    if !settings.enabled {
        return connect_error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "failed_precondition",
            "Devin gateway is disabled",
        );
    }
    if !authorized(&parts.headers, &settings.auth_token) {
        return connect_error_response(
            StatusCode::UNAUTHORIZED,
            "unauthenticated",
            "invalid Devin gateway token",
        );
    }

    let content_encoding = parts
        .headers
        .get("connect-content-encoding")
        .or_else(|| parts.headers.get(header::CONTENT_ENCODING))
        .and_then(|value| value.to_str().ok());
    let body = match to_bytes(body, MAX_BODY_SIZE + 5).await {
        Ok(body) => body,
        Err(error) => return protocol_error(StatusCode::PAYLOAD_TOO_LARGE, error.to_string()),
    };
    let payload = match wire::unwrap_request(&body, content_encoding) {
        Ok(payload) => payload,
        Err(error) => return protocol_error(StatusCode::BAD_REQUEST, error.to_string()),
    };

    let candidates = settings
        .bindings
        .iter()
        .filter(|binding| binding.enabled)
        .map(|binding| binding.model_uid.clone())
        .collect::<HashSet<_>>();
    if method == "GetCliModelConfigs" {
        let gateway_url = format!("http://127.0.0.1:{}", settings.local_api_port);
        let catalog = match catalog::model_configs_payload(&settings, &gateway_url)
            .and_then(|catalog| catalog::rewrite_model_configs(&catalog, &settings, &gateway_url))
        {
            Ok(catalog) => catalog,
            Err(error) => {
                return protocol_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
            }
        };
        return protocol_success_response(&body, &catalog);
    }

    let reference =
        match find_model_reference(&payload, &parts.headers, &candidates, &state.assignments) {
            Ok(reference) => reference,
            Err(error) => return protocol_error(StatusCode::BAD_REQUEST, error.to_string()),
        };
    if reference.ambiguous {
        return protocol_error(
            StatusCode::BAD_REQUEST,
            format!(
                "Devin request contains multiple mapped model UIDs: {}",
                reference.candidates.join(", ")
            ),
        );
    }
    if method == "AssignModel" {
        let Some(uid) = (!reference.uid.is_empty()).then_some(reference.uid) else {
            return protocol_error(
                StatusCode::BAD_REQUEST,
                "Devin AssignModel has no mapped model UID",
            );
        };
        if !candidates.contains(&uid) {
            return protocol_error(
                StatusCode::BAD_REQUEST,
                format!("Devin model is not assigned: {uid}"),
            );
        }
        let assignment = state.assignments.issue(&uid);
        let harness_uid = format!("cursor-byok:{uid}");
        let response = match assignment_token_response(&assignment, &harness_uid) {
            Ok(response) => response,
            Err(error) => {
                return protocol_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
            }
        };
        return protocol_success_response(&body, &response);
    }

    let request = match parse_chat_request(&payload) {
        Ok(request) => request,
        Err(error) => return protocol_error(StatusCode::BAD_REQUEST, error.to_string()),
    };
    let mut request = request;
    if request.requested_model.is_empty() {
        request.requested_model = reference.uid;
    }
    let binding = match settings.binding(&request.requested_model).cloned() {
        Some(binding) => binding,
        None => {
            return protocol_error(
                StatusCode::BAD_REQUEST,
                format!("Devin model is not assigned: {}", request.requested_model),
            )
        }
    };
    let model = match state.store.model(&binding.model_hash).await {
        Ok(Some(model)) => model,
        Ok(None) => {
            return protocol_error(
                StatusCode::BAD_REQUEST,
                format!("cursor-byok model hash not found: {}", binding.model_hash),
            )
        }
        Err(error) => return protocol_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
    };
    let provider_type = model.provider_type();
    let fallback_input_tokens = request.context_tokens;
    let invocation = match to_invocation(request, &binding, &model) {
        Ok(invocation) => invocation,
        Err(error) => return protocol_error(StatusCode::BAD_REQUEST, error.to_string()),
    };
    let model_uid = binding.model_uid.clone();
    let cancellation = CancellationToken::new();
    let mut provider_stream = state.provider.stream(invocation, cancellation);
    let mut response_state = ResponseState::new("devin-response", provider_type);
    response_state.set_fallback_input_tokens(fallback_input_tokens);
    let stream = async_stream::stream! {
        while let Some(event) = provider_stream.next().await {
            match event {
                Ok(event) => {
                    let done = matches!(&event, ModelEvent::Done(_));
                    match stream_event(&mut response_state, event) {
                        Ok(frames) => {
                            for frame in frames {
                                yield Ok::<Bytes, std::io::Error>(Bytes::from(frame));
                            }
                        }
                        Err(error) => {
                            yield Ok::<Bytes, std::io::Error>(stream_error(error));
                            return;
                        }
                    }
                    if done {
                        match finish(response_state, &model_uid) {
                            Ok(frames) => {
                                for frame in frames {
                                    yield Ok::<Bytes, std::io::Error>(Bytes::from(frame));
                                }
                            }
                            Err(error) => yield Ok::<Bytes, std::io::Error>(stream_error(error)),
                        }
                        return;
                    }
                }
                Err(error) => {
                    yield Ok::<Bytes, std::io::Error>(stream_error(error));
                    return;
                }
            }
        }
        yield Ok::<Bytes, std::io::Error>(stream_error("provider stream ended without Done"));
    };
    streaming_response(stream)
}

fn authorized(headers: &HeaderMap, configured: &str) -> bool {
    if configured.is_empty() {
        return true;
    }
    headers
        .get(TOKEN_HEADER)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value == configured)
        || headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .is_some_and(|value| value == configured)
}

fn plain_error(status: StatusCode, message: &str) -> Response<Body> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Body::from(message.to_owned()))
        .expect("static Devin error response")
}

fn protocol_error(status: StatusCode, message: impl Into<String>) -> Response<Body> {
    let code = match status {
        StatusCode::UNAUTHORIZED => "unauthenticated",
        StatusCode::PAYLOAD_TOO_LARGE => "resource_exhausted",
        StatusCode::SERVICE_UNAVAILABLE => "failed_precondition",
        StatusCode::INTERNAL_SERVER_ERROR => "internal",
        _ => "invalid_argument",
    };
    connect_error_response(status, code, message)
}

fn protocol_success_response(request_body: &[u8], payload: &[u8]) -> Response<Body> {
    let (body, content_type) = if wire::is_connect_envelope(request_body) {
        let mut body =
            wire::frame(payload, false).unwrap_or_else(|error| stream_error(error).to_vec());
        body.extend_from_slice(&wire::end_frame(None));
        (body, "application/connect+proto")
    } else {
        (payload.to_vec(), "application/proto")
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(body))
        .expect("Devin protocol success response")
}

fn connect_error_response(
    _status: StatusCode,
    code: &str,
    message: impl Into<String>,
) -> Response<Body> {
    let frame = wire::end_frame(Some(ConnectError {
        code: code.into(),
        message: message.into(),
    }));
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/connect+proto")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(frame))
        .expect("Devin protocol error response")
}

fn streaming_response<S>(stream: S) -> Response<Body>
where
    S: futures_util::Stream<Item = std::result::Result<Bytes, std::io::Error>> + Send + 'static,
{
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/connect+proto")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from_stream(stream))
        .expect("Devin streaming response")
}

fn stream_error(error: impl std::fmt::Display) -> Bytes {
    Bytes::from(wire::end_frame(Some(ConnectError {
        code: "internal".into(),
        message: error.to_string(),
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_auth_accepts_header_or_bearer_token() {
        let mut headers = HeaderMap::new();
        headers.insert(TOKEN_HEADER, "secret".parse().unwrap());
        assert!(authorized(&headers, "secret"));
        headers.remove(TOKEN_HEADER);
        headers.insert(header::AUTHORIZATION, "Bearer secret".parse().unwrap());
        assert!(authorized(&headers, "secret"));
        assert!(!authorized(&HeaderMap::new(), "secret"));
        assert!(authorized(&HeaderMap::new(), ""));
    }

    #[test]
    fn error_frame_is_bounded_by_the_same_wire_limit() {
        let frame = stream_error("provider failed");
        assert!(frame.len() < MAX_BODY_SIZE);
        assert_eq!(frame[0], 2);
    }
}
