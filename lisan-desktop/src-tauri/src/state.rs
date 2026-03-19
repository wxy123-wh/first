use std::sync::Mutex;

pub struct AppState {
    pub base_dir: Mutex<String>,
}

impl AppState {
    pub fn new(base_dir: String) -> Self {
        Self {
            base_dir: Mutex::new(base_dir),
        }
    }
}
