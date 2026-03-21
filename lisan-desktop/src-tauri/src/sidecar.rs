use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant, SystemTime},
};
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{oneshot, Mutex},
    time::timeout,
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const RESTART_DELAY: Duration = Duration::from_secs(1);
const RAPID_EXIT_THRESHOLD: Duration = Duration::from_secs(5);
const MAX_RAPID_RESTARTS: u32 = 3;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone)]
pub struct SidecarManager {
    inner: Arc<SidecarInner>,
}

struct SidecarInner {
    workspace_root: PathBuf,
    node_binary: String,
    process: Mutex<Option<SidecarProcess>>,
    restart_policy: Mutex<RestartPolicyState>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
    next_request_id: AtomicU64,
    next_process_id: AtomicU64,
}

struct SidecarProcess {
    id: u64,
    project_path: PathBuf,
    started_at: Instant,
    stdin: Arc<Mutex<ChildStdin>>,
    child: Arc<Mutex<Child>>,
}

#[derive(Default)]
struct RestartPolicyState {
    rapid_exit_count: u32,
}

enum RestartDecision {
    Restart,
    Stop,
}

impl SidecarManager {
    pub fn new(workspace_root: PathBuf) -> Self {
        Self {
            inner: Arc::new(SidecarInner {
                workspace_root,
                node_binary: std::env::var("LISAN_NODE_BIN").unwrap_or_else(|_| "node".to_string()),
                process: Mutex::new(None),
                restart_policy: Mutex::new(RestartPolicyState::default()),
                pending: Mutex::new(HashMap::new()),
                next_request_id: AtomicU64::new(1),
                next_process_id: AtomicU64::new(1),
            }),
        }
    }

    pub async fn open_project(
        &self,
        app: &AppHandle,
        project_path: PathBuf,
    ) -> Result<Value, String> {
        let canonical_project_path = canonicalize_or_clone(project_path);
        self.ensure_started(app, canonical_project_path.clone())
            .await?;

        let params = json!({
            "path": canonical_project_path.to_string_lossy().to_string()
        });
        match self.send_request("project.open", params).await {
            Ok(result) => Ok(result),
            Err(err) if is_method_not_found(&err) => Ok(json!({
                "opened": true,
                "path": canonical_project_path.to_string_lossy().to_string()
            })),
            Err(err) => Err(err),
        }
    }

    pub async fn call(
        &self,
        app: &AppHandle,
        method: &str,
        params: Value,
    ) -> Result<Value, String> {
        self.ensure_running(app).await?;
        self.send_request(method, params).await
    }

    pub async fn call_with_fallback(
        &self,
        app: &AppHandle,
        methods: &[&str],
        params: Value,
    ) -> Result<Value, String> {
        self.ensure_running(app).await?;
        let mut last_error = String::new();

        for method in methods {
            match self.send_request(method, params.clone()).await {
                Ok(result) => return Ok(result),
                Err(err) if is_method_not_found(&err) => {
                    last_error = err;
                }
                Err(err) => return Err(err),
            }
        }

        if methods.is_empty() {
            return Err("No RPC methods provided".to_string());
        }

        if last_error.is_empty() {
            last_error = format!("All fallback RPC methods failed: {}", methods.join(", "));
        }

        Err(last_error)
    }

    async fn ensure_running(&self, app: &AppHandle) -> Result<(), String> {
        if self.inner.process.lock().await.is_some() {
            return Ok(());
        }

        let _ = app.emit(
            "sidecar:error",
            json!({ "message": "sidecar is not running, call project_open first" }),
        );
        Err("Sidecar is not running, call project_open first".to_string())
    }

    async fn ensure_started(&self, app: &AppHandle, project_path: PathBuf) -> Result<(), String> {
        let current = {
            let guard = self.inner.process.lock().await;
            guard
                .as_ref()
                .map(|p| canonicalize_or_clone(p.project_path.clone()))
        };

        if let Some(current_path) = current {
            if current_path == project_path {
                return Ok(());
            }
        }

        self.stop_existing().await;
        self.spawn_process(app, project_path).await
    }

    async fn spawn_process(&self, app: &AppHandle, project_path: PathBuf) -> Result<(), String> {
        let sidecar_script = self.resolve_sidecar_script().ok_or_else(|| {
            format!(
                "Cannot find sidecar entry. Tried: {}, {}, and LISAN_ENGINE_SIDECAR env",
                self.inner
                    .workspace_root
                    .join("packages/engine/dist/sidecar/main.js")
                    .display(),
                self.inner
                    .workspace_root
                    .join("packages/engine/dist/sidecar/main.cjs")
                    .display()
            )
        })?;
        validate_sidecar_build_consistency(&self.inner.workspace_root, &sidecar_script)?;

        let project_arg = project_path.to_string_lossy().to_string();
        let mut command = Command::new(&self.inner.node_binary);
        command
            .arg(&sidecar_script)
            .arg("--project-path")
            .arg(&project_arg)
            .current_dir(&self.inner.workspace_root)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        #[cfg(windows)]
        {
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command.spawn().map_err(|err| {
            format!(
                "Failed to spawn sidecar with LISAN_NODE_BIN='{}': {err}",
                self.inner.node_binary
            )
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to capture sidecar stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture sidecar stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to capture sidecar stderr".to_string())?;

        let process_id = self.inner.next_process_id.fetch_add(1, Ordering::SeqCst);
        let child = Arc::new(Mutex::new(child));
        let process = SidecarProcess {
            id: process_id,
            project_path: project_path.clone(),
            started_at: Instant::now(),
            stdin: Arc::new(Mutex::new(stdin)),
            child: child.clone(),
        };

        {
            let mut guard = self.inner.process.lock().await;
            *guard = Some(process);
        }

        let _ = app.emit(
            "sidecar:started",
            json!({
                "projectPath": project_arg,
                "scriptPath": sidecar_script.to_string_lossy().to_string(),
            }),
        );

        self.spawn_stdout_task(app.clone(), stdout);
        self.spawn_stderr_task(app.clone(), stderr);
        self.spawn_exit_monitor(app.clone(), child, process_id, project_path);

        Ok(())
    }

    async fn stop_existing(&self) {
        let previous = {
            let mut guard = self.inner.process.lock().await;
            guard.take()
        };

        if let Some(process) = previous {
            let mut child = process.child.lock().await;
            let _ = child.kill().await;
            let _ = child.wait().await;
        }

        self.clear_pending("sidecar stopped").await;
    }

    async fn send_request(&self, method: &str, params: Value) -> Result<Value, String> {
        let request_id = self.inner.next_request_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.inner.pending.lock().await.insert(request_id, tx);

        let payload = json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params,
        });
        let payload_line = format!(
            "{}\n",
            serde_json::to_string(&payload)
                .map_err(|err| format!("Failed to encode JSON-RPC request: {err}"))?
        );

        let stdin = {
            let guard = self.inner.process.lock().await;
            guard
                .as_ref()
                .map(|p| p.stdin.clone())
                .ok_or_else(|| "Sidecar is not running".to_string())?
        };

        let write_result = async {
            let mut stdin_guard = stdin.lock().await;
            stdin_guard
                .write_all(payload_line.as_bytes())
                .await
                .map_err(|err| format!("Failed to write request to sidecar stdin: {err}"))?;
            stdin_guard
                .flush()
                .await
                .map_err(|err| format!("Failed to flush sidecar stdin: {err}"))?;
            Ok::<(), String>(())
        }
        .await;

        if let Err(err) = write_result {
            self.inner.pending.lock().await.remove(&request_id);
            return Err(err);
        }

        match timeout(REQUEST_TIMEOUT, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(format!(
                "Sidecar response channel closed for method {method}"
            )),
            Err(_) => {
                self.inner.pending.lock().await.remove(&request_id);
                Err(format!(
                    "Timed out waiting for sidecar response: method={method}, id={request_id}"
                ))
            }
        }
    }

    async fn clear_pending(&self, reason: &str) {
        let mut pending = self.inner.pending.lock().await;
        for (_, tx) in pending.drain() {
            let _ = tx.send(Err(reason.to_string()));
        }
    }

    fn spawn_stdout_task(&self, app: AppHandle, stdout: tokio::process::ChildStdout) {
        let manager = self.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                let message = match serde_json::from_str::<Value>(trimmed) {
                    Ok(value) => value,
                    Err(err) => {
                        let _ = app.emit(
                            "sidecar:error",
                            json!({ "message": format!("Invalid sidecar JSON: {err}") }),
                        );
                        continue;
                    }
                };

                if let Some(id) = parse_response_id(&message) {
                    let result = parse_response_result(&message);
                    if let Some(tx) = manager.inner.pending.lock().await.remove(&id) {
                        let _ = tx.send(result);
                    }
                    continue;
                }

                let _ = app.emit("sidecar:notification", message.clone());
                if let Some(method) = message.get("method").and_then(Value::as_str) {
                    let params = message.get("params").cloned().unwrap_or(Value::Null);
                    let event_name = format!("sidecar:{}", method.replace('.', ":"));
                    let _ = app.emit(
                        &event_name,
                        json!({
                            "method": method,
                            "params": params,
                        }),
                    );
                }
            }
        });
    }

    fn spawn_stderr_task(&self, app: AppHandle, stderr: tokio::process::ChildStderr) {
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = app.emit("sidecar:stderr", json!({ "line": line }));
            }
        });
    }

    fn spawn_exit_monitor(
        &self,
        app: AppHandle,
        child: Arc<Mutex<Child>>,
        process_id: u64,
        project_path: PathBuf,
    ) {
        let manager = self.clone();
        tokio::spawn(async move {
            loop {
                let status = {
                    let mut guard = child.lock().await;
                    match guard.try_wait() {
                        Ok(value) => value,
                        Err(err) => {
                            let _ = app.emit(
                                "sidecar:error",
                                json!({ "message": format!("Failed to poll sidecar process: {err}") }),
                            );
                            break;
                        }
                    }
                };

                if let Some(exit_status) = status {
                    let (should_restart, stop_reason) = {
                        let mut guard = manager.inner.process.lock().await;
                        if let Some(current) = guard.as_ref() {
                            if current.id == process_id {
                                let uptime = current.started_at.elapsed();
                                guard.take();
                                let mut policy = manager.inner.restart_policy.lock().await;
                                match evaluate_restart_policy(&mut policy, uptime) {
                                    RestartDecision::Restart => (true, None),
                                    RestartDecision::Stop => {
                                        let message = format!(
                                            "Sidecar 连续快速退出（code={:?}）。已暂停自动重启，避免无限弹窗。请检查 LISAN_NODE_BIN（当前: {}）并确认可手动运行 sidecar。",
                                            exit_status.code(),
                                            manager.inner.node_binary
                                        );
                                        (false, Some(message))
                                    }
                                }
                            } else {
                                (false, None)
                            }
                        } else {
                            (false, None)
                        }
                    };

                    if should_restart {
                        manager.clear_pending("sidecar exited").await;
                        let _ = app.emit(
                            "sidecar:exit",
                            json!({
                                "code": exit_status.code(),
                                "projectPath": project_path.to_string_lossy().to_string(),
                            }),
                        );

                        tokio::time::sleep(RESTART_DELAY).await;
                        if let Err(err) = manager
                            .spawn_process(&app, canonicalize_or_clone(project_path.clone()))
                            .await
                        {
                            let _ = app.emit(
                                "sidecar:error",
                                json!({ "message": format!("Failed to restart sidecar: {err}") }),
                            );
                        }
                    }
                    if let Some(message) = stop_reason {
                        let _ = app.emit("sidecar:error", json!({ "message": message }));
                    }

                    break;
                }

                tokio::time::sleep(Duration::from_millis(400)).await;
            }
        });
    }

    fn resolve_sidecar_script(&self) -> Option<PathBuf> {
        let env_override = std::env::var("LISAN_ENGINE_SIDECAR")
            .ok()
            .map(PathBuf::from);
        let mut candidates = vec![
            self.inner
                .workspace_root
                .join("packages")
                .join("engine")
                .join("dist")
                .join("sidecar")
                .join("main.js"),
            self.inner
                .workspace_root
                .join("packages")
                .join("engine")
                .join("dist")
                .join("sidecar")
                .join("main.cjs"),
        ];

        if let Some(path) = env_override {
            candidates.insert(0, path);
        }

        candidates.into_iter().find(|path| path.exists())
    }
}

fn parse_response_id(message: &Value) -> Option<u64> {
    let id = message.get("id")?;
    if let Some(value) = id.as_u64() {
        return Some(value);
    }
    id.as_str()?.parse::<u64>().ok()
}

fn parse_response_result(message: &Value) -> Result<Value, String> {
    if let Some(error) = message.get("error") {
        let code = error.get("code").and_then(Value::as_i64).unwrap_or(-32000);
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Unknown sidecar error");
        return Err(format!("RPC error {code}: {message}"));
    }

    Ok(message.get("result").cloned().unwrap_or(Value::Null))
}

fn canonicalize_or_clone(path: PathBuf) -> PathBuf {
    path.canonicalize().unwrap_or(path)
}

fn is_method_not_found(err: &str) -> bool {
    let normalized = err.to_ascii_lowercase();
    normalized.contains("method not found") || normalized.contains("rpc error -32601")
}

fn evaluate_restart_policy(state: &mut RestartPolicyState, uptime: Duration) -> RestartDecision {
    if uptime <= RAPID_EXIT_THRESHOLD {
        state.rapid_exit_count = state.rapid_exit_count.saturating_add(1);
        if state.rapid_exit_count > MAX_RAPID_RESTARTS {
            return RestartDecision::Stop;
        }
        return RestartDecision::Restart;
    }

    state.rapid_exit_count = 0;
    RestartDecision::Restart
}

fn validate_sidecar_build_consistency(
    workspace_root: &Path,
    sidecar_script: &Path,
) -> Result<(), String> {
    let dist_modified = read_modified(sidecar_script)?;
    let engine_root = workspace_root.join("packages").join("engine");
    let source_root = engine_root.join("src");
    if !source_root.exists() {
        return Ok(());
    }

    let mut latest_source = latest_modified_recursive(&source_root)?;
    for extra in ["package.json", "tsconfig.json", "tsup.config.ts"] {
        let candidate = engine_root.join(extra);
        if candidate.exists() {
            latest_source = max_modified(latest_source, Some(read_modified(&candidate)?));
        }
    }

    let Some(source_modified) = latest_source else {
        return Ok(());
    };

    let tolerance = Duration::from_secs(1);
    let source_newer = dist_modified
        .checked_add(tolerance)
        .map(|threshold| source_modified > threshold)
        .unwrap_or(source_modified > dist_modified);
    if source_newer {
        return Err("检测到 @lisan/engine 源码版本新于 sidecar 构建产物。请重建 @lisan/engine sidecar 后重试（pnpm --filter @lisan/engine build）。".to_string());
    }
    Ok(())
}

fn read_modified(path: &Path) -> Result<SystemTime, String> {
    std::fs::metadata(path)
        .map_err(|err| format!("读取文件信息失败: {} ({err})", path.display()))?
        .modified()
        .map_err(|err| format!("读取文件修改时间失败: {} ({err})", path.display()))
}

fn latest_modified_recursive(root: &Path) -> Result<Option<SystemTime>, String> {
    let mut latest: Option<SystemTime> = None;
    let entries = std::fs::read_dir(root)
        .map_err(|err| format!("读取目录失败: {} ({err})", root.display()))?;
    for entry in entries {
        let entry = entry.map_err(|err| format!("读取目录项失败: {} ({err})", root.display()))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|err| format!("读取文件类型失败: {} ({err})", path.display()))?;
        if file_type.is_dir() {
            latest = max_modified(latest, latest_modified_recursive(&path)?);
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let modified = entry
            .metadata()
            .map_err(|err| format!("读取文件信息失败: {} ({err})", path.display()))?
            .modified()
            .map_err(|err| format!("读取文件修改时间失败: {} ({err})", path.display()))?;
        latest = max_modified(latest, Some(modified));
    }
    Ok(latest)
}

fn max_modified(lhs: Option<SystemTime>, rhs: Option<SystemTime>) -> Option<SystemTime> {
    match (lhs, rhs) {
        (Some(a), Some(b)) => Some(if b > a { b } else { a }),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{create_dir_all, write};
    use std::path::PathBuf;
    use std::thread::sleep;
    use std::time::Duration;

    fn make_temp_workspace(case_name: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "lisan-sidecar-consistency-{}-{}",
            case_name,
            std::process::id()
        ));
        if base.exists() {
            let _ = std::fs::remove_dir_all(&base);
        }
        create_dir_all(base.join("packages/engine/src")).unwrap();
        create_dir_all(base.join("packages/engine/dist/sidecar")).unwrap();
        base
    }

    #[test]
    fn blocks_when_engine_source_is_newer_than_sidecar_dist() {
        let workspace = make_temp_workspace("mismatch");
        let dist = workspace.join("packages/engine/dist/sidecar/main.js");
        let source = workspace.join("packages/engine/src/main.ts");

        write(&dist, "dist").unwrap();
        sleep(Duration::from_millis(1200));
        write(&source, "source").unwrap();

        let result = validate_sidecar_build_consistency(&workspace, &dist);
        assert!(result.is_err());
        assert!(result
            .err()
            .unwrap()
            .contains("请重建 @lisan/engine sidecar"));

        let _ = std::fs::remove_dir_all(workspace);
    }

    #[test]
    fn allows_when_sidecar_dist_is_up_to_date() {
        let workspace = make_temp_workspace("match");
        let dist = workspace.join("packages/engine/dist/sidecar/main.js");
        let source = workspace.join("packages/engine/src/main.ts");

        write(&source, "source").unwrap();
        sleep(Duration::from_millis(1200));
        write(&dist, "dist").unwrap();

        let result = validate_sidecar_build_consistency(&workspace, &dist);
        assert!(result.is_ok());

        let _ = std::fs::remove_dir_all(workspace);
    }

    #[test]
    fn restart_policy_stops_after_too_many_rapid_exits() {
        let mut state = RestartPolicyState::default();
        let rapid_uptime = Duration::from_millis(300);

        for _ in 0..MAX_RAPID_RESTARTS {
            let decision = evaluate_restart_policy(&mut state, rapid_uptime);
            assert!(matches!(decision, RestartDecision::Restart));
        }

        let blocked = evaluate_restart_policy(&mut state, rapid_uptime);
        assert!(matches!(blocked, RestartDecision::Stop));
    }

    #[test]
    fn restart_policy_resets_after_stable_run() {
        let mut state = RestartPolicyState::default();
        let rapid_uptime = Duration::from_millis(300);
        let stable_uptime = RAPID_EXIT_THRESHOLD + Duration::from_secs(1);

        let _ = evaluate_restart_policy(&mut state, rapid_uptime);
        let _ = evaluate_restart_policy(&mut state, stable_uptime);

        let decision = evaluate_restart_policy(&mut state, rapid_uptime);
        assert!(matches!(decision, RestartDecision::Restart));
    }
}
