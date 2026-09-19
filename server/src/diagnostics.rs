use serde::Serialize;

#[derive(Clone, Debug)]
pub struct DiagnosticInput {
    pub source: String,
    pub request_id: Option<String>,
    pub call_id: Option<String>,
    pub http_status: Option<u16>,
    pub message: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ErrorDiagnosis {
    pub category: &'static str,
    pub title_key: &'static str,
    pub reason_key: &'static str,
    pub suggestion_key: &'static str,
}

pub fn classify_error(http_status: Option<u16>, message: Option<&str>) -> ErrorDiagnosis {
    let message = message.unwrap_or_default().to_ascii_lowercase();
    let category = match http_status {
        Some(401 | 403) => "authentication",
        Some(408 | 504) => "timeout",
        Some(429) => "rate_limit",
        _ if message.contains("kv set") || message.contains("kv get") => "cursor_sync",
        _ if message.contains("timeout")
            || message.contains("timed out")
            || message.contains("deadline") =>
        {
            "timeout"
        }
        _ if message.contains("connect")
            || message.contains("connection refused")
            || message.contains("connection reset")
            || message.contains("reset by peer")
            || message.contains("broken pipe")
            || message.contains("network is unreachable")
            || message.contains("certificate")
            || message.contains("tls")
            || message.contains("dns")
            || message.contains("proxy") =>
        {
            "network"
        }
        Some(status) if status >= 500 => "upstream",
        _ if message.contains("database")
            || message.contains("sqlite")
            || message.contains("locked")
            || message.contains("migration") =>
        {
            "database"
        }
        _ if message.contains("json")
            || message.contains("decode")
            || message.contains("parse")
            || message.contains("format") =>
        {
            "response_format"
        }
        _ => "unknown",
    };

    let (title_key, reason_key, suggestion_key) = diagnosis_keys(category);
    ErrorDiagnosis {
        category,
        title_key,
        reason_key,
        suggestion_key,
    }
}

pub(crate) fn diagnosis_keys(category: &'static str) -> (&'static str, &'static str, &'static str) {
    match category {
        "authentication" => (
            "diagnostic.title.authentication",
            "diagnostic.reason.authentication",
            "diagnostic.suggestion.authentication",
        ),
        "timeout" => (
            "diagnostic.title.timeout",
            "diagnostic.reason.timeout",
            "diagnostic.suggestion.timeout",
        ),
        "rate_limit" => (
            "diagnostic.title.rate_limit",
            "diagnostic.reason.rate_limit",
            "diagnostic.suggestion.rate_limit",
        ),
        "cursor_sync" => (
            "diagnostic.title.cursor_sync",
            "diagnostic.reason.cursor_sync",
            "diagnostic.suggestion.cursor_sync",
        ),
        "upstream" => (
            "diagnostic.title.upstream",
            "diagnostic.reason.upstream",
            "diagnostic.suggestion.upstream",
        ),
        "network" => (
            "diagnostic.title.network",
            "diagnostic.reason.network",
            "diagnostic.suggestion.network",
        ),
        "database" => (
            "diagnostic.title.database",
            "diagnostic.reason.database",
            "diagnostic.suggestion.database",
        ),
        "response_format" => (
            "diagnostic.title.response_format",
            "diagnostic.reason.response_format",
            "diagnostic.suggestion.response_format",
        ),
        _ => (
            "diagnostic.title.unknown",
            "diagnostic.reason.unknown",
            "diagnostic.suggestion.unknown",
        ),
    }
}

pub fn sanitize_error_message(message: &str) -> String {
    let mut value = message
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    for marker in [
        "authorization: bearer ",
        "authorization=bearer ",
        "bearer ",
        "api_key=",
        "api-key=",
    ] {
        value = redact_value_after(&value, marker);
    }
    for marker in ["prompt=", "prompt:"] {
        if let Some(index) = value.to_ascii_lowercase().find(marker) {
            value.truncate(index);
            value.push_str("[redacted]");
        }
    }
    value.chars().take(2_048).collect()
}

fn redact_value_after(value: &str, marker: &str) -> String {
    let Some(index) = value.to_ascii_lowercase().find(marker) else {
        return value.to_owned();
    };
    let value_start = index + marker.len();
    let value_end = value[value_start..]
        .find(char::is_whitespace)
        .map(|offset| value_start + offset)
        .unwrap_or(value.len());
    format!("{}[redacted]{}", &value[..index], &value[value_end..])
}

#[cfg(test)]
mod tests {
    use super::{classify_error, sanitize_error_message, DiagnosticInput};
    use crate::store::Store;

    #[test]
    fn classifies_authentication_failure_with_localizable_explanation() {
        let diagnosis = classify_error(Some(401), Some("invalid api key"));

        assert_eq!(diagnosis.category, "authentication");
        assert_eq!(diagnosis.title_key, "diagnostic.title.authentication");
        assert_eq!(diagnosis.reason_key, "diagnostic.reason.authentication");
        assert_eq!(
            diagnosis.suggestion_key,
            "diagnostic.suggestion.authentication"
        );
    }

    #[test]
    fn classifies_cursor_blob_sync_failures_separately_from_network_failures() {
        let diagnosis = classify_error(None, Some("protocol error: KV SET timed out"));

        assert_eq!(diagnosis.category, "cursor_sync");
        assert_eq!(diagnosis.title_key, "diagnostic.title.cursor_sync");
    }

    #[test]
    fn sanitizes_secrets_and_limits_error_text() {
        let message = format!(
            "authorization: Bearer {} prompt={} {}",
            "secret-token",
            "private prompt",
            "x".repeat(3_000)
        );

        let sanitized = sanitize_error_message(&message);

        assert!(!sanitized.contains("secret-token"));
        assert!(!sanitized.contains("private prompt"));
        assert!(sanitized.len() <= 2_048);
    }

    #[tokio::test]
    async fn stores_a_localizable_diagnostic_without_the_secret() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::connect(&format!(
            "sqlite://{}",
            dir.path().join("diagnostics.db").display()
        ))
        .await
        .unwrap();

        store
            .record_diagnostic(DiagnosticInput {
                source: "cursor_request".into(),
                request_id: Some("req-1".into()),
                call_id: None,
                http_status: Some(401),
                message: Some("invalid api key Bearer secret-token".into()),
            })
            .await
            .unwrap();

        let records = store.diagnostics(10).await.unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].category, "authentication");
        assert_eq!(records[0].reason_key, "diagnostic.reason.authentication");
        assert_eq!(records[0].request_id.as_deref(), Some("req-1"));
        assert!(!records[0].message.contains("secret-token"));
    }
}
