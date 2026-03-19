use std::path::Path;
use std::process::Stdio;
use tauri::{Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::state::AppState;

#[tauri::command]
pub async fn run_cli_command(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    args: Vec<String>,
    event_id: String,
) -> Result<(), String> {
    let base_dir = state.base_dir.lock().unwrap().clone();
    let project_path = Path::new(&base_dir).join(&project_id);

    let cli_path = Path::new(&base_dir)
        .join("packages")
        .join("cli")
        .join("dist")
        .join("index.js");

    let mut child = Command::new("node")
        .arg(cli_path.to_str().unwrap_or(""))
        .arg("-p")
        .arg(project_path.to_str().unwrap_or(""))
        .args(&args)
        .current_dir(&project_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn process: {}", e))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let app_stdout = app.clone();
    let event_id_stdout = event_id.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = app_stdout.emit(
                &format!("cli-output-{}", event_id_stdout),
                serde_json::json!({ "line": line, "is_stderr": false }),
            );
        }
    });

    let app_stderr = app.clone();
    let event_id_stderr = event_id.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = app_stderr.emit(
                &format!("cli-output-{}", event_id_stderr),
                serde_json::json!({ "line": line, "is_stderr": true }),
            );
        }
    });

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Process error: {}", e))?;

    let _ = app.emit(
        &format!("cli-done-{}", event_id),
        serde_json::json!({ "success": status.success() }),
    );

    Ok(())
}
