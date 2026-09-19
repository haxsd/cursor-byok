use serde::Serialize;
use sqlx::Row;

use crate::{
    diagnostics::{classify_error, diagnosis_keys, sanitize_error_message, DiagnosticInput},
    Result,
};

use super::{now_ms, Store};

#[derive(Clone, Debug, Serialize)]
pub struct DiagnosticRecord {
    pub diagnostic_id: i64,
    pub created_at_ms: i64,
    pub source: String,
    pub request_id: Option<String>,
    pub call_id: Option<String>,
    pub http_status: Option<i64>,
    pub category: String,
    pub title_key: String,
    pub reason_key: String,
    pub suggestion_key: String,
    pub message: String,
}

impl Store {
    pub async fn record_diagnostic(&self, input: DiagnosticInput) -> Result<DiagnosticRecord> {
        let created_at_ms = now_ms();
        let diagnosis = classify_error(input.http_status, input.message.as_deref());
        let message = sanitize_error_message(input.message.as_deref().unwrap_or_default());
        let _write = self.writes.lock().await;
        let result = sqlx::query(
            "INSERT INTO error_diagnostics(
                created_at_ms, source, request_id, call_id, http_status,
                category, title_key, reason_key, suggestion_key, message
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(created_at_ms)
        .bind(&input.source)
        .bind(&input.request_id)
        .bind(&input.call_id)
        .bind(input.http_status.map(i64::from))
        .bind(diagnosis.category)
        .bind(diagnosis.title_key)
        .bind(diagnosis.reason_key)
        .bind(diagnosis.suggestion_key)
        .bind(&message)
        .execute(&self.pool)
        .await?;
        Ok(DiagnosticRecord {
            diagnostic_id: result.last_insert_rowid(),
            created_at_ms,
            source: input.source,
            request_id: input.request_id,
            call_id: input.call_id,
            http_status: input.http_status.map(i64::from),
            category: diagnosis.category.into(),
            title_key: diagnosis.title_key.into(),
            reason_key: diagnosis.reason_key.into(),
            suggestion_key: diagnosis.suggestion_key.into(),
            message,
        })
    }

    pub async fn diagnostics(&self, limit: i64) -> Result<Vec<DiagnosticRecord>> {
        let rows = sqlx::query(
            "SELECT diagnostic_id, created_at_ms, source, request_id, call_id,
                    http_status, category, title_key, reason_key, suggestion_key, message
             FROM error_diagnostics
             ORDER BY created_at_ms DESC, diagnostic_id DESC LIMIT ?",
        )
        .bind(limit.clamp(1, 500))
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(record_from_row).collect()
    }
}

fn record_from_row(row: sqlx::sqlite::SqliteRow) -> Result<DiagnosticRecord> {
    let category: String = row.try_get("category")?;
    let category_static = match category.as_str() {
        "authentication" => "authentication",
        "timeout" => "timeout",
        "rate_limit" => "rate_limit",
        "cursor_sync" => "cursor_sync",
        "upstream" => "upstream",
        "network" => "network",
        "database" => "database",
        "response_format" => "response_format",
        _ => "unknown",
    };
    let (title_key, reason_key, suggestion_key) = diagnosis_keys(category_static);
    Ok(DiagnosticRecord {
        diagnostic_id: row.try_get("diagnostic_id")?,
        created_at_ms: row.try_get("created_at_ms")?,
        source: row.try_get("source")?,
        request_id: row.try_get("request_id")?,
        call_id: row.try_get("call_id")?,
        http_status: row.try_get("http_status")?,
        category,
        title_key: title_key.into(),
        reason_key: reason_key.into(),
        suggestion_key: suggestion_key.into(),
        message: row.try_get("message")?,
    })
}
