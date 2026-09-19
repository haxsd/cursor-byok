//! Optional Devin protocol integration.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

pub const DEFAULT_DEVIN_API_PORT: u16 = 43_110;
pub const DEFAULT_DEVIN_INFERENCE_PORT: u16 = 43_111;
pub const DEFAULT_DEVIN_LOCAL_API_PORT: u16 = 43_112;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct DevinSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_api_port")]
    pub api_port: u16,
    #[serde(default = "default_inference_port")]
    pub inference_port: u16,
    #[serde(default = "default_local_api_port")]
    pub local_api_port: u16,
    #[serde(default)]
    pub bindings: Vec<DevinModelBinding>,
}

impl Default for DevinSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            api_port: DEFAULT_DEVIN_API_PORT,
            inference_port: DEFAULT_DEVIN_INFERENCE_PORT,
            local_api_port: DEFAULT_DEVIN_LOCAL_API_PORT,
            bindings: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct DevinModelBinding {
    pub model_uid: String,
    pub model_hash: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub context_window_tokens: Option<u64>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

impl DevinModelBinding {
    pub fn new(model_uid: impl Into<String>, model_hash: impl Into<String>) -> Self {
        Self {
            model_uid: model_uid.into(),
            model_hash: model_hash.into(),
            display_name: String::new(),
            context_window_tokens: None,
            enabled: true,
        }
    }
}

impl DevinSettings {
    pub fn validate(&self) -> Result<()> {
        for (name, port) in [
            ("api", self.api_port),
            ("inference", self.inference_port),
            ("local API", self.local_api_port),
        ] {
            if port == 0 {
                return Err(Error::Config(format!("Devin {name} port must be non-zero")));
            }
        }
        if self.api_port == self.inference_port
            || self.api_port == self.local_api_port
            || self.inference_port == self.local_api_port
        {
            return Err(Error::Config("Devin ports must be distinct".into()));
        }

        let mut uids = HashSet::with_capacity(self.bindings.len());
        for binding in &self.bindings {
            let uid = binding.model_uid.trim();
            if uid.is_empty() {
                return Err(Error::Config("Devin model UID must not be empty".into()));
            }
            if binding.model_hash.trim().is_empty() {
                return Err(Error::Config(format!(
                    "Devin model binding for {uid} must include a cursor-byok model hash"
                )));
            }
            if !uids.insert(uid.to_owned()) {
                return Err(Error::Config(format!("duplicate Devin model UID: {uid}")));
            }
        }
        Ok(())
    }

    pub fn binding(&self, model_uid: &str) -> Option<&DevinModelBinding> {
        self.bindings
            .iter()
            .find(|binding| binding.enabled && binding.model_uid == model_uid)
    }
}

impl Default for DevinModelBinding {
    fn default() -> Self {
        Self::new("", "")
    }
}

fn default_true() -> bool {
    true
}

fn default_api_port() -> u16 {
    DEFAULT_DEVIN_API_PORT
}

fn default_inference_port() -> u16 {
    DEFAULT_DEVIN_INFERENCE_PORT
}

fn default_local_api_port() -> u16 {
    DEFAULT_DEVIN_LOCAL_API_PORT
}

pub mod request;
pub mod response;
pub mod wire;
