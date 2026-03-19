mod commands;
mod state;

use commands::cli::run_cli_command;
use commands::config::{get_config, save_config};
use commands::executions::{get_execution_detail, get_executions};
use commands::files::browse_files;
use commands::projects::{create_project, delete_project, list_projects};
use state::AppState;

fn default_base_dir() -> String {
    "D:\\code\\lisan".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::new(default_base_dir()))
        .invoke_handler(tauri::generate_handler![
            list_projects,
            create_project,
            delete_project,
            get_config,
            save_config,
            browse_files,
            get_executions,
            get_execution_detail,
            run_cli_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
