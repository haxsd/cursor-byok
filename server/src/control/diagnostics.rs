//! Exposes lightweight, privacy-preserving error diagnoses to the desktop UI.
use axum::{
    extract::{Query, State},
    Json,
};
use serde::Deserialize;

use crate::{store::DiagnosticRecord, Result};

use super::ControlService;

#[derive(Deserialize)]
pub struct DiagnosticQuery {
    #[serde(default = "default_limit")]
    limit: i64,
}

pub async fn list(
    State(service): State<ControlService>,
    Query(query): Query<DiagnosticQuery>,
) -> Result<Json<Vec<DiagnosticRecord>>> {
    Ok(Json(service.diagnostics(query.limit).await?))
}

fn default_limit() -> i64 {
    200
}
