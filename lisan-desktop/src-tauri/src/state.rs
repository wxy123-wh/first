use std::path::PathBuf;

use crate::sidecar::SidecarManager;

pub struct AppState {
    pub workspace_root: PathBuf,
    pub sidecar: SidecarManager,
}

impl AppState {
    pub fn new(workspace_root: PathBuf) -> Self {
        Self {
            sidecar: SidecarManager::new(workspace_root.clone()),
            workspace_root,
        }
    }
}
