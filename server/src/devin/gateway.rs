//! Loopback-only Devin Connect gateway.
//!
//! This listener is intentionally separate from the Cursor listener. It is
//! disabled by default and only reads the persisted Devin binding table when
//! it is explicitly enabled.

use std::{net::SocketAddr, sync::Arc};

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

use crate::{model::ModelEvent, provider::Provider, store::Store, Error, Result};

use super::{
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

        let api = axum::serve(api_listener, router.clone());
        let inference = axum::serve(inference_listener, router.clone());
        let local = axum::serve(local_listener, router);
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
    if method != "GetChatMessage" {
        return plain_error(StatusCode::NOT_FOUND, "unsupported Devin RPC method");
    }

    let settings = match state.store.devin_settings().await {
        Ok(settings) => settings,
        Err(error) => return protocol_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
    };
    if !settings.enabled {
        return plain_error(StatusCode::SERVICE_UNAVAILABLE, "Devin gateway is disabled");
    }
    if !authorized(&parts.headers, &settings.auth_token) {
        return plain_error(StatusCode::UNAUTHORIZED, "invalid Devin gateway token");
    }

    let content_encoding = parts
        .headers
        .get(header::CONTENT_ENCODING)
        .and_then(|value| value.to_str().ok());
    let body = match to_bytes(body, MAX_BODY_SIZE + 5).await {
        Ok(body) => body,
        Err(error) => return protocol_error(StatusCode::PAYLOAD_TOO_LARGE, error.to_string()),
    };
    let payload = match wire::unwrap_request(&body, content_encoding) {
        Ok(payload) => payload,
        Err(error) => return protocol_error(StatusCode::BAD_REQUEST, error.to_string()),
    };
    let request = match parse_chat_request(&payload) {
        Ok(request) => request,
        Err(error) => return protocol_error(StatusCode::BAD_REQUEST, error.to_string()),
    };
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
    let invocation = match to_invocation(request, &binding, &model) {
        Ok(invocation) => invocation,
        Err(error) => return protocol_error(StatusCode::BAD_REQUEST, error.to_string()),
    };
    let model_uid = binding.model_uid.clone();
    let cancellation = CancellationToken::new();
    let mut provider_stream = state.provider.stream(invocation, cancellation);
    let mut response_state = ResponseState::new("devin-response", provider_type);
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
    let body = serde_json::json!({ "code": "invalid_argument", "message": message.into() });
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
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
