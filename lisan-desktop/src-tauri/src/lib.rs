mod commands;
mod sidecar;
mod state;

use commands::{
    agent_delete, agent_get_md, agent_list, agent_save, agent_save_md, chapter_create,
    chapter_delete, chapter_get_content, chapter_list, chapter_save, chapter_save_content, create_project,
    delete_project, execution_detail, execution_list, list_projects, outline_get, outline_save,
    project_get, project_open, project_update, provider_delete, provider_list, provider_save,
    rag_status, rag_sync, scene_delete, scene_list, scene_reorder, scene_save, setting_delete,
    setting_get, setting_list, setting_save, workflow_abort, workflow_list, workflow_pause,
    workflow_rerun, workflow_resume, workflow_run, workflow_save, workflow_skip, truth_read,
    truth_update,
};
use state::AppState;
use std::path::PathBuf;

fn default_workspace_root() -> PathBuf {
    if let Ok(path) = std::env::var("LISAN_WORKSPACE_ROOT") {
        return PathBuf::from(path);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::new(default_workspace_root()))
        .invoke_handler(tauri::generate_handler![
            list_projects,
            create_project,
            delete_project,
            project_open,
            project_get,
            project_update,
            outline_get,
            outline_save,
            workflow_list,
            workflow_save,
            workflow_run,
            workflow_pause,
            workflow_resume,
            workflow_skip,
            workflow_rerun,
            workflow_abort,
            agent_list,
            agent_save,
            agent_delete,
            agent_get_md,
            agent_save_md,
            provider_list,
            provider_save,
            provider_delete,
            scene_list,
            scene_save,
            scene_delete,
            scene_reorder,
            chapter_list,
            chapter_save,
            chapter_create,
            chapter_delete,
            chapter_get_content,
            chapter_save_content,
            setting_list,
            setting_get,
            setting_save,
            setting_delete,
            execution_list,
            execution_detail,
            truth_read,
            truth_update,
            rag_sync,
            rag_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
