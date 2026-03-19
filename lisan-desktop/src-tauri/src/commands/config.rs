use std::fs;
use std::path::Path;
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub fn get_config(state: State<'_, AppState>, id: String) -> Result<String, String> {
    let base_dir = state.base_dir.lock().unwrap().clone();
    let config_path = Path::new(&base_dir).join(&id).join("lisan.config.yaml");
    fs::read_to_string(&config_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_config(
    state: State<'_, AppState>,
    id: String,
    content: String,
) -> Result<(), String> {
    let base_dir = state.base_dir.lock().unwrap().clone();
    let config_path = Path::new(&base_dir).join(&id).join("lisan.config.yaml");
    fs::write(&config_path, content).map_err(|e| e.to_string())
}
