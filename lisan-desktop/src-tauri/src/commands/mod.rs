use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

use crate::state::AppState;
pub mod projects;
pub use projects::{create_project, delete_project, list_projects};

async fn rpc_call(
    state: &State<'_, AppState>,
    app: &AppHandle,
    methods: &[&str],
    params: Value,
) -> Result<Value, String> {
    state.sidecar.call_with_fallback(app, methods, params).await
}

async fn rpc_void(
    state: &State<'_, AppState>,
    app: &AppHandle,
    methods: &[&str],
    params: Value,
) -> Result<(), String> {
    rpc_call(state, app, methods, params).await.map(|_| ())
}

fn normalize_project_path(workspace_root: &Path, raw_path: &str) -> PathBuf {
    let project_path = PathBuf::from(raw_path);
    let absolute = if project_path.is_absolute() {
        project_path
    } else {
        workspace_root.join(project_path)
    };
    absolute.canonicalize().unwrap_or(absolute)
}

fn is_method_not_found(err: &str) -> bool {
    let normalized = err.to_ascii_lowercase();
    normalized.contains("method not found") || normalized.contains("rpc error -32601")
}

fn normalize_workflow_run_error(err: String) -> String {
    if is_method_not_found(&err) {
        return "工作流运行失败：当前 sidecar 不支持 workflow.run/workflow.rerun。请重建 @lisan/engine sidecar 后重试。"
            .to_string();
    }
    err
}

fn build_agent_register_params(agent: &Value) -> Value {
    json!({
        "name": agent.get("name").cloned().unwrap_or(Value::String("未命名智能体".to_string())),
        "agentMd": agent.get("agentMd").cloned().unwrap_or(Value::String(String::new())),
        "provider": agent.get("provider").cloned().unwrap_or(Value::String("openai".to_string())),
        "model": agent.get("model").cloned().unwrap_or(Value::String("gpt-4o".to_string())),
        "temperature": agent.get("temperature").cloned().unwrap_or(Value::from(0.7)),
        "maxTokens": agent.get("maxTokens").cloned().unwrap_or(Value::Null),
        "promptTemplate": agent.get("promptTemplate").cloned().unwrap_or(Value::String("{{instructions}}".to_string())),
        "inputSchema": agent.get("inputSchema").cloned().unwrap_or(Value::Array(vec![])),
    })
}

fn build_agent_update_patch(agent: &Value) -> Value {
    json!({
        "name": agent.get("name").cloned(),
        "provider": agent.get("provider").cloned(),
        "model": agent.get("model").cloned(),
        "temperature": agent.get("temperature").cloned(),
        "maxTokens": agent.get("maxTokens").cloned(),
        "promptTemplate": agent.get("promptTemplate").cloned(),
        "inputSchema": agent.get("inputSchema").cloned(),
    })
}

fn default_provider_list() -> Value {
    const FALLBACK_TIME: &str = "1970-01-01T00:00:00.000Z";
    json!([
        {
            "id": "openai",
            "name": "OpenAI",
            "type": "openai",
            "model": "gpt-4o",
            "baseUrl": Value::Null,
            "apiKey": Value::Null,
            "createdAt": FALLBACK_TIME,
            "updatedAt": FALLBACK_TIME,
        },
        {
            "id": "anthropic",
            "name": "Anthropic",
            "type": "anthropic",
            "model": "claude-opus-4-6",
            "baseUrl": Value::Null,
            "apiKey": Value::Null,
            "createdAt": FALLBACK_TIME,
            "updatedAt": FALLBACK_TIME,
        },
        {
            "id": "newapi",
            "name": "NewAPI",
            "type": "newapi",
            "model": "gpt-4o",
            "baseUrl": Value::Null,
            "apiKey": Value::Null,
            "createdAt": FALLBACK_TIME,
            "updatedAt": FALLBACK_TIME,
        }
    ])
}

#[tauri::command]
pub async fn project_open(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<Value, String> {
    let project_path = normalize_project_path(&state.workspace_root, &path);
    state.sidecar.open_project(&app, project_path).await
}

#[tauri::command]
pub async fn project_get(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<Value, String> {
    rpc_call(&state, &app, &["project.get"], json!({ "id": id })).await
}

#[tauri::command]
pub async fn project_update(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    patch: Value,
) -> Result<Value, String> {
    rpc_call(
        &state,
        &app,
        &["project.update"],
        json!({ "id": id, "patch": patch }),
    )
    .await
}

#[tauri::command]
pub async fn outline_get(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    rpc_call(&state, &app, &["outline.get"], json!({})).await
}

#[tauri::command]
pub async fn outline_save(
    app: AppHandle,
    state: State<'_, AppState>,
    content: String,
) -> Result<(), String> {
    rpc_void(
        &state,
        &app,
        &["outline.save"],
        json!({ "content": content }),
    )
    .await
}

#[tauri::command]
pub async fn workflow_list(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Value, String> {
    rpc_call(
        &state,
        &app,
        &["workflow.list"],
        json!({ "projectId": project_id }),
    )
    .await
}

#[tauri::command]
pub async fn workflow_save(
    app: AppHandle,
    state: State<'_, AppState>,
    workflow: Value,
) -> Result<Value, String> {
    rpc_call(
        &state,
        &app,
        &["workflow.save"],
        json!({ "workflow": workflow }),
    )
    .await
}

#[tauri::command]
pub async fn workflow_run(
    app: AppHandle,
    state: State<'_, AppState>,
    workflow_id: String,
    chapter_id: Option<String>,
    global_context: Option<Value>,
) -> Result<Value, String> {
    rpc_call(
        &state,
        &app,
        &["workflow.run", "workflow.rerun"],
        json!({
            "workflowId": workflow_id,
            "chapterId": chapter_id,
            "globalContext": global_context.unwrap_or_else(|| json!({})),
        }),
    )
    .await
    .map_err(normalize_workflow_run_error)
}

#[tauri::command]
pub async fn workflow_pause(
    app: AppHandle,
    state: State<'_, AppState>,
    execution_id: String,
) -> Result<(), String> {
    rpc_void(
        &state,
        &app,
        &["workflow.pause"],
        json!({ "executionId": execution_id }),
    )
    .await
}

#[tauri::command]
pub async fn workflow_resume(
    app: AppHandle,
    state: State<'_, AppState>,
    execution_id: String,
) -> Result<(), String> {
    rpc_void(
        &state,
        &app,
        &["workflow.resume"],
        json!({ "executionId": execution_id }),
    )
    .await
}

#[tauri::command]
pub async fn workflow_skip(
    app: AppHandle,
    state: State<'_, AppState>,
    execution_id: String,
    step_id: String,
) -> Result<(), String> {
    rpc_void(
        &state,
        &app,
        &["workflow.skip"],
        json!({ "executionId": execution_id, "stepId": step_id }),
    )
    .await
}

#[tauri::command]
pub async fn workflow_rerun(
    app: AppHandle,
    state: State<'_, AppState>,
    workflow_id: String,
    chapter_id: Option<String>,
) -> Result<(), String> {
    rpc_void(
        &state,
        &app,
        &["workflow.rerun", "workflow.run"],
        json!({
            "workflowId": workflow_id,
            "chapterId": chapter_id,
            "globalContext": {},
        }),
    )
    .await
}

#[tauri::command]
pub async fn workflow_abort(
    app: AppHandle,
    state: State<'_, AppState>,
    execution_id: String,
) -> Result<(), String> {
    rpc_void(
        &state,
        &app,
        &["workflow.abort"],
        json!({ "executionId": execution_id }),
    )
    .await
}

#[tauri::command]
pub async fn agent_list(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    rpc_call(&state, &app, &["agent.list"], json!({})).await
}

#[tauri::command]
pub async fn agent_save(
    app: AppHandle,
    state: State<'_, AppState>,
    agent: Value,
) -> Result<Value, String> {
    let save_result = state
        .sidecar
        .call(&app, "agent.save", json!({ "agent": agent.clone() }))
        .await;

    match save_result {
        Ok(result) => Ok(result),
        Err(err) if is_method_not_found(&err) => {
            if let Some(id) = agent.get("id").and_then(Value::as_str) {
                state
                    .sidecar
                    .call(
                        &app,
                        "agent.update",
                        json!({
                            "id": id,
                            "patch": build_agent_update_patch(&agent),
                        }),
                    )
                    .await
            } else {
                state
                    .sidecar
                    .call(&app, "agent.register", build_agent_register_params(&agent))
                    .await
            }
        }
        Err(err) => Err(err),
    }
}

#[tauri::command]
pub async fn agent_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    rpc_void(&state, &app, &["agent.delete"], json!({ "id": id })).await
}

#[tauri::command]
pub async fn agent_get_md(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<Value, String> {
    rpc_call(&state, &app, &["agent.getMd"], json!({ "id": id })).await
}

#[tauri::command]
pub async fn agent_save_md(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    content: String,
) -> Result<(), String> {
    match state
        .sidecar
        .call(
            &app,
            "agent.saveMd",
            json!({ "id": id, "content": content }),
        )
        .await
    {
        Ok(_) => Ok(()),
        Err(err) if is_method_not_found(&err) => {
            Err("Current sidecar does not implement agent.saveMd".to_string())
        }
        Err(err) => Err(err),
    }
}

#[tauri::command]
pub async fn provider_list(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    match rpc_call(&state, &app, &["provider.list"], json!({})).await {
        Ok(result) => Ok(result),
        Err(err) if is_method_not_found(&err) => Ok(default_provider_list()),
        Err(err) => Err(err),
    }
}

#[tauri::command]
pub async fn provider_save(
    app: AppHandle,
    state: State<'_, AppState>,
    provider: Value,
) -> Result<Value, String> {
    match rpc_call(
        &state,
        &app,
        &["provider.save"],
        json!({ "provider": provider }),
    )
    .await
    {
        Ok(result) => Ok(result),
        Err(err) if is_method_not_found(&err) => Err(
            "Current sidecar does not implement provider.save. Rebuild @lisan/engine sidecar to enable provider editing.".to_string(),
        ),
        Err(err) => Err(err),
    }
}

#[tauri::command]
pub async fn provider_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    match rpc_void(&state, &app, &["provider.delete"], json!({ "id": id })).await {
        Ok(_) => Ok(()),
        Err(err) if is_method_not_found(&err) => Err(
            "Current sidecar does not implement provider.delete. Rebuild @lisan/engine sidecar to enable provider editing.".to_string(),
        ),
        Err(err) => Err(err),
    }
}

#[tauri::command]
pub async fn scene_list(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Value, String> {
    rpc_call(
        &state,
        &app,
        &["scene.list"],
        json!({ "projectId": project_id }),
    )
    .await
}

#[tauri::command]
pub async fn scene_save(
    app: AppHandle,
    state: State<'_, AppState>,
    scene: Value,
) -> Result<Value, String> {
    rpc_call(&state, &app, &["scene.save"], json!({ "scene": scene })).await
}

#[tauri::command]
pub async fn scene_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    rpc_void(&state, &app, &["scene.delete"], json!({ "id": id })).await
}

#[tauri::command]
pub async fn scene_reorder(
    app: AppHandle,
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<(), String> {
    rpc_void(&state, &app, &["scene.reorder"], json!({ "ids": ids })).await
}

#[tauri::command]
pub async fn chapter_list(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Value, String> {
    rpc_call(
        &state,
        &app,
        &["chapter.list"],
        json!({ "projectId": project_id }),
    )
    .await
}

#[tauri::command]
pub async fn chapter_get_content(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<Value, String> {
    rpc_call(&state, &app, &["chapter.getContent"], json!({ "id": id })).await
}

#[tauri::command]
pub async fn chapter_save(
    app: AppHandle,
    state: State<'_, AppState>,
    chapter: Value,
) -> Result<Value, String> {
    rpc_call(
        &state,
        &app,
        &["chapter.save", "chapter.create"],
        json!({ "chapter": chapter }),
    )
    .await
}

#[tauri::command]
pub async fn chapter_create(
    app: AppHandle,
    state: State<'_, AppState>,
    chapter: Value,
) -> Result<Value, String> {
    rpc_call(
        &state,
        &app,
        &["chapter.create", "chapter.save"],
        json!({ "chapter": chapter }),
    )
    .await
}

#[tauri::command]
pub async fn chapter_save_content(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    content: String,
) -> Result<(), String> {
    rpc_void(
        &state,
        &app,
        &["chapter.saveContent"],
        json!({ "id": id, "content": content }),
    )
    .await
}

#[tauri::command]
pub async fn execution_list(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Value, String> {
    rpc_call(
        &state,
        &app,
        &["execution.list"],
        json!({ "projectId": project_id }),
    )
    .await
}

#[tauri::command]
pub async fn execution_detail(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<Value, String> {
    rpc_call(
        &state,
        &app,
        &["execution.detail", "execution.get"],
        json!({ "id": id }),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_workflow_run_error_maps_method_not_found() {
        let error = "RPC error -32601: Method not found: workflow.run".to_string();
        let normalized = normalize_workflow_run_error(error);
        assert!(normalized.contains("workflow.run"));
        assert!(normalized.contains("请重建 @lisan/engine sidecar"));
    }

    #[test]
    fn normalize_workflow_run_error_keeps_other_errors() {
        let error = "RPC error -32000: provider api key missing".to_string();
        let normalized = normalize_workflow_run_error(error.clone());
        assert_eq!(normalized, error);
    }
}
