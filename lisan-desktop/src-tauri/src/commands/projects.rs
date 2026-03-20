use serde::{Deserialize, Serialize};
use std::fs;
use tauri::State;

use crate::state::AppState;

#[derive(Serialize, Deserialize, Debug)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub status: String,
    #[serde(rename = "chapterCount")]
    pub chapter_count: usize,
    #[serde(rename = "lastExecutionTime")]
    pub last_execution_time: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct LlmProviderConfig {
    pub provider: String,
    pub model: String,
    pub temperature: f64,
}

#[derive(Deserialize, Debug)]
pub struct LlmConfig {
    pub orchestrator: Option<LlmProviderConfig>,
    pub worker: Option<LlmProviderConfig>,
}

#[derive(Deserialize, Debug)]
pub struct CreateProjectInput {
    pub name: String,
    pub plugin: Option<String>,
    #[serde(rename = "llmConfig")]
    pub llm_config: Option<LlmConfig>,
}

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> Result<Vec<Project>, String> {
    let base_path = state.workspace_root.as_path();

    let mut projects = Vec::new();

    let entries = fs::read_dir(base_path).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }

        let project_path = entry.path();
        let lisan_dir = project_path.join(".lisan");
        let has_legacy_config = lisan_dir.join("config.yaml").exists();
        let has_current_config = project_path.join("lisan.config.yaml").exists();
        if !has_legacy_config && !has_current_config {
            continue;
        }

        let traces_dir = lisan_dir.join("traces");
        let mut chapter_count = 0usize;
        let mut last_execution_time: Option<String> = None;

        if traces_dir.exists() {
            if let Ok(trace_entries) = fs::read_dir(&traces_dir) {
                let mut jsonl_files: Vec<String> = trace_entries
                    .flatten()
                    .filter_map(|e| {
                        let name = e.file_name().to_string_lossy().to_string();
                        if name.ends_with(".jsonl") {
                            Some(name)
                        } else {
                            None
                        }
                    })
                    .collect();
                chapter_count = jsonl_files.len();
                jsonl_files.sort();
                if let Some(latest) = jsonl_files.last() {
                    last_execution_time = Some(latest.trim_end_matches(".jsonl").to_string());
                }
            }
        }

        let id = entry.file_name().to_string_lossy().to_string();
        projects.push(Project {
            name: id.clone(),
            path: project_path.to_string_lossy().to_string(),
            status: if chapter_count > 0 {
                "active".to_string()
            } else {
                "initialized".to_string()
            },
            chapter_count,
            last_execution_time,
            id,
        });
    }

    Ok(projects)
}

#[tauri::command]
pub fn create_project(
    state: State<'_, AppState>,
    data: CreateProjectInput,
) -> Result<Project, String> {
    let project_root = state.workspace_root.join(&data.name);

    if project_root.exists() {
        return Err("项目已存在".to_string());
    }

    let dirs = [
        "大纲",
        "设定集",
        "场景树",
        "正文",
        ".lisan/tmp",
        ".lisan/traces",
    ];

    for d in &dirs {
        fs::create_dir_all(project_root.join(d)).map_err(|e| e.to_string())?;
    }

    let plugin = data.plugin.as_deref().unwrap_or("webnovel");
    let orch_provider = data
        .llm_config
        .as_ref()
        .and_then(|c| c.orchestrator.as_ref())
        .map(|o| o.provider.as_str())
        .unwrap_or("anthropic");
    let orch_model = data
        .llm_config
        .as_ref()
        .and_then(|c| c.orchestrator.as_ref())
        .map(|o| o.model.as_str())
        .unwrap_or("claude-opus-4-20250514");
    let orch_temp = data
        .llm_config
        .as_ref()
        .and_then(|c| c.orchestrator.as_ref())
        .map(|o| o.temperature)
        .unwrap_or(0.7);
    let worker_provider = data
        .llm_config
        .as_ref()
        .and_then(|c| c.worker.as_ref())
        .map(|o| o.provider.as_str())
        .unwrap_or("openai");
    let worker_model = data
        .llm_config
        .as_ref()
        .and_then(|c| c.worker.as_ref())
        .map(|o| o.model.as_str())
        .unwrap_or("gpt-4o");
    let worker_temp = data
        .llm_config
        .as_ref()
        .and_then(|c| c.worker.as_ref())
        .map(|o| o.temperature)
        .unwrap_or(0.85);

    let config_content = format!(
        r#"version: "1"
book:
  id: "{name}"
  title: "{name}"
  plugin: "{plugin}"

llm:
  orchestrator:
    provider: {orch_provider}
    model: {orch_model}
    temperature: {orch_temp}
  worker:
    provider: {worker_provider}
    model: {worker_model}
    temperature: {worker_temp}

rag:
  provider: lancedb
  embedModel: text-embedding-v3
  embedBaseUrl: ${{EMBED_BASE_URL}}
  embedApiKey: ${{EMBED_API_KEY}}

pipeline:
  write:
    chapterWordRange: [3000, 4000]
    passes: [pass-1, pass-2, pass-3, pass-4, pass-5]
    autoGitCommit: true
"#,
        name = data.name,
        plugin = plugin,
        orch_provider = orch_provider,
        orch_model = orch_model,
        orch_temp = orch_temp,
        worker_provider = worker_provider,
        worker_model = worker_model,
        worker_temp = worker_temp,
    );

    fs::write(project_root.join("lisan.config.yaml"), &config_content)
        .map_err(|e| e.to_string())?;
    fs::write(
        project_root.join(".lisan").join("config.yaml"),
        &config_content,
    )
    .map_err(|e| e.to_string())?;

    let sample_outline = format!(
        "# {} - 故事大纲\n\n## 第一卷：起始\n\n### 第一章\n- 主角登场\n- 引入核心冲突\n\n### 第二章\n- 世界观展开\n- 关键角色出场\n",
        data.name
    );
    fs::write(project_root.join("大纲").join("arc-1.md"), &sample_outline)
        .map_err(|e| e.to_string())?;

    Ok(Project {
        id: data.name.clone(),
        name: data.name.clone(),
        path: project_root.to_string_lossy().to_string(),
        status: "initialized".to_string(),
        chapter_count: 0,
        last_execution_time: None,
    })
}

#[tauri::command]
pub fn delete_project(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let lisan_dir = state.workspace_root.join(&id).join(".lisan");

    if !lisan_dir.exists() {
        return Err("项目不存在".to_string());
    }

    fs::remove_dir_all(&lisan_dir).map_err(|e| e.to_string())?;
    Ok(())
}
