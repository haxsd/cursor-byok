//! Devin router settings and explicit host integration endpoints.

use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    extract::{Query, State},
    Json,
};
use serde::Deserialize;

use crate::{
    devin::{
        gateway::DevinListening,
        host_patch::{self, DevinPorts, PatchReceipt, PatchStatus},
        host_status as host_status_module, DevinSettings,
    },
    Error, Result,
};

use super::{ControlService, DevinStatus};

pub async fn get(State(service): State<ControlService>) -> Result<Json<DevinSettings>> {
    Ok(Json(service.devin_settings().await?))
}

#[derive(Clone)]
pub struct DevinStatusState {
    pub service: ControlService,
    pub listening: DevinListening,
}

pub async fn status(State(state): State<Arc<DevinStatusState>>) -> Result<Json<DevinStatus>> {
    let listening = state.listening.is_listening();
    Ok(Json(state.service.devin_status(listening).await?))
}

pub async fn update(
    State(service): State<ControlService>,
    Json(settings): Json<DevinSettings>,
) -> Result<Json<DevinSettings>> {
    Ok(Json(service.set_devin_settings(settings).await?))
}

#[derive(Debug, Deserialize)]
pub struct HostPathQuery {
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct HostPatchInput {
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct HostRestoreInput {
    pub receipt: PatchReceipt,
}

pub async fn host_status(Query(query): Query<HostPathQuery>) -> Result<Json<PatchStatus>> {
    let path = explicit_path(&query.path)?;
    Ok(Json(host_status_module::status(&path)?))
}

pub async fn host_apply(
    State(service): State<ControlService>,
    Json(input): Json<HostPatchInput>,
) -> Result<Json<PatchReceipt>> {
    let settings = service.devin_settings().await?;
    if !settings.enabled {
        return Err(Error::Config("启用 Devin 网关后才能应用宿主补丁".into()));
    }
    let path = explicit_path(&input.path)?;
    let ports = DevinPorts {
        api_port: settings.api_port,
        inference_port: settings.inference_port,
        local_api_port: settings.local_api_port,
    };
    Ok(Json(host_patch::apply(&path, ports)?))
}

pub async fn host_restore(Json(input): Json<HostRestoreInput>) -> Result<Json<serde_json::Value>> {
    host_patch::restore(&input.receipt)?;
    Ok(Json(serde_json::json!({"restored": true})))
}

fn explicit_path(value: &str) -> Result<PathBuf> {
    let path = PathBuf::from(value.trim());
    if path.as_os_str().is_empty() || !path.is_absolute() {
        return Err(Error::Config("Devin 宿主文件必须是明确的绝对路径".into()));
    }
    Ok(path)
}
