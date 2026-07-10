use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use log::{info, warn};

const PYTHON_VERSION: &str = "3.12.8";
const PYTHON_EMBED_URL_WIN: &str = "https://www.python.org/ftp/python/3.12.8/python-3.12.8-embed-amd64.zip";

pub struct ServerManager {
    child: Mutex<Option<Child>>,
}

impl ServerManager {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }

    pub fn start(&self, app_dir: &Path) -> Result<(), String> {
        let mut child = self.child.lock().map_err(|e| e.to_string())?;
        if child.is_some() {
            return Ok(());
        }

        // Strategy 1: bundled server.exe (PyInstaller)
        if let Some(exe) = find_server_exe(app_dir) {
            info!("Found bundled server.exe: {:?}", exe);
            let mut cmd = Command::new(&exe);
            cmd.current_dir(app_dir)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());

            let process = cmd.spawn().map_err(|e| format!("Failed to start server.exe: {e}"))?;
            Self::setup_logging(process, &mut child);
            return Ok(());
        }

        // Strategy 2: Python venv
        if let Some(python) = find_venv_python(app_dir) {
            info!("Found venv Python: {:?}", python);
            return self.start_with_python(&python, app_dir, &mut child);
        }

        // Strategy 3: System Python
        if let Some(python) = find_system_python() {
            info!("Found system Python: {:?}", python);
            let python_path = PathBuf::from(&python);
            return self.start_with_python(&python_path, app_dir, &mut child);
        }

        // Strategy 4: Download embeddable Python
        info!("No Python found, attempting to download embeddable Python...");
        let python_dir = app_dir.join("python_embed");
        let python_exe = python_dir.join("python.exe");

        if !python_exe.exists() {
            download_embeddable_python(&python_dir)?;
        }

        if python_exe.exists() {
            // Install dependencies into the embeddable Python
            install_deps(&python_dir, app_dir)?;
            info!("Using downloaded Python: {:?}", python_exe);
            return self.start_with_python(&python_exe, app_dir, &mut child);
        }

        Err("Python not found. Install Python 3.10+ or place server.exe next to the app.".to_string())
    }

    fn start_with_python(
        &self,
        python: &Path,
        app_dir: &Path,
        child: &mut std::sync::MutexGuard<Option<Child>>,
    ) -> Result<(), String> {
        let mut cmd = Command::new(python);
        cmd.args(["-m", "uvicorn", "server.main:app", "--host", "127.0.0.1", "--port", "8000"])
            .current_dir(app_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let process = cmd.spawn().map_err(|e| format!("Failed to start server: {e}"))?;
        Self::setup_logging(process, child);
        Ok(())
    }

    fn setup_logging(process: Child, child: &mut std::sync::MutexGuard<Option<Child>>) {
        let mut process = process;

        if let Some(stdout) = process.stdout.take() {
            std::thread::spawn(move || {
                use std::io::{BufRead, BufReader};
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        info!("[server] {}", line);
                    }
                }
            });
        }
        if let Some(stderr) = process.stderr.take() {
            std::thread::spawn(move || {
                use std::io::{BufRead, BufReader};
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        warn!("[server] {}", line);
                    }
                }
            });
        }

        **child = Some(process);
    }

    pub fn wait_ready(&self, timeout_secs: u64) -> Result<(), String> {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .map_err(|e| e.to_string())?;

        let start = std::time::Instant::now();
        let timeout = Duration::from_secs(timeout_secs);

        loop {
            if start.elapsed() > timeout {
                return Err("Server did not start in time".to_string());
            }

            match client.get("http://127.0.0.1:8000/health").send() {
                Ok(resp) if resp.status().is_success() => {
                    info!("Server is ready");
                    return Ok(());
                }
                _ => {
                    std::thread::sleep(Duration::from_millis(500));
                }
            }
        }
    }

    pub fn stop(&self) {
        let mut child = self.child.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(mut process) = child.take() {
            info!("Stopping server (pid: {})", process.id());
            let _ = process.kill();
            let _ = process.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_server_manager_creation() {
        let manager = ServerManager::new();
        assert!(manager.child.lock().unwrap().is_none());
    }

    #[test]
    fn test_stop_without_start() {
        let manager = ServerManager::new();
        manager.stop();
        let child = manager.child.lock().unwrap();
        assert!(child.is_none());
    }

    #[test]
    fn test_find_system_python() {
        let python = find_system_python();
        assert!(python.is_none() || python.is_some());
    }
}

impl Drop for ServerManager {
    fn drop(&mut self) {
        self.stop();
    }
}

// ── Finders ──

fn find_server_exe(app_dir: &Path) -> Option<PathBuf> {
    // 1. Next to the app executable
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(dir) = exe_path.parent() {
            let server_exe = dir.join("server.exe");
            if server_exe.exists() {
                return Some(server_exe);
            }
        }
    }

    // 2. In app_dir
    let server_exe = app_dir.join("server.exe");
    if server_exe.exists() {
        return Some(server_exe);
    }

    // 3. In dist/server/
    let dist_server = app_dir.join("dist").join("server").join("server.exe");
    if dist_server.exists() {
        return Some(dist_server);
    }

    None
}

fn find_venv_python(app_dir: &Path) -> Option<PathBuf> {
    let venv_python = if cfg!(windows) {
        app_dir.join(".venv").join("Scripts").join("python.exe")
    } else {
        app_dir.join(".venv").join("bin").join("python")
    };

    if venv_python.exists() {
        Some(venv_python)
    } else {
        None
    }
}

fn find_system_python() -> Option<String> {
    let names = if cfg!(windows) {
        vec!["python", "python3"]
    } else {
        vec!["python3", "python"]
    };

    for name in names {
        if Command::new(name).arg("--version").output().is_ok() {
            return Some(name.to_string());
        }
    }

    None
}

// ── Embeddable Python ──

fn download_embeddable_python(target_dir: &Path) -> Result<(), String> {
    use std::io::Write;

    info!("Downloading Python {} embeddable...", PYTHON_VERSION);
    std::fs::create_dir_all(target_dir).map_err(|e| e.to_string())?;

    let zip_path = target_dir.join("python.zip");

    // Download
    let resp = reqwest::blocking::get(PYTHON_EMBED_URL_WIN)
        .map_err(|e| format!("Download failed: {e}"))?;

    let bytes = resp.bytes().map_err(|e| format!("Read failed: {e}"))?;
    let mut file = std::fs::File::create(&zip_path).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    drop(file);

    // Extract
    let zip_file = std::fs::File::open(&zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(zip_file).map_err(|e| format!("Invalid zip: {e}"))?;
    archive.extract(target_dir).map_err(|e| format!("Extract failed: {e}"))?;
    drop(archive);

    // Cleanup zip
    let _ = std::fs::remove_file(&zip_path);

    // Enable site-packages: uncomment "import site" in python312._pth
    let pth_files: Vec<_> = std::fs::read_dir(target_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            name.ends_with("._pth") || name.ends_with(".pth")
        })
        .collect();

    for entry in pth_files {
        let content = std::fs::read_to_string(entry.path()).unwrap_or_default();
        let fixed = content.replace("#import site", "import site");
        let _ = std::fs::write(entry.path(), fixed);
    }

    info!("Python embeddable downloaded to {:?}", target_dir);
    Ok(())
}

fn install_deps(python_dir: &Path, app_dir: &Path) -> Result<(), String> {
    let python_exe = python_dir.join("python.exe");
    if !python_exe.exists() {
        return Err("Python exe not found after download".to_string());
    }

    // Install pip
    let get_pip = python_dir.join("get-pip.py");
    if !get_pip.exists() {
        info!("Downloading get-pip.py...");
        let resp = reqwest::blocking::get("https://bootstrap.pypa.io/get-pip.py")
            .map_err(|e| format!("Download get-pip failed: {e}"))?;
        std::fs::write(&get_pip, resp.bytes().map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    }

    info!("Installing pip...");
    let status = Command::new(&python_exe)
        .arg(&get_pip)
        .current_dir(python_dir)
        .status()
        .map_err(|e| format!("pip install failed: {e}"))?;

    if !status.success() {
        return Err("Failed to install pip".to_string());
    }

    // Install requirements
    let pip_exe = python_dir.join("Scripts").join("pip.exe");
    if pip_exe.exists() {
        info!("Installing dependencies...");
        let req_file = app_dir.join("requirements.txt");
        let status = Command::new(&pip_exe)
            .args(["install", "-r", req_file.to_str().unwrap()])
            .current_dir(app_dir)
            .status()
            .map_err(|e| format!("deps install failed: {e}"))?;

        if !status.success() {
            return Err("Failed to install dependencies".to_string());
        }
    }

    Ok(())
}
