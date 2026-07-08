use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use log::{info, warn};

pub struct ServerManager {
    child: Mutex<Option<Child>>,
}

impl ServerManager {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }

    pub fn start(&self, app_dir: &std::path::Path) -> Result<(), String> {
        let mut child = self.child.lock().map_err(|e| e.to_string())?;
        if child.is_some() {
            return Ok(());
        }

        // Try to find Python: venv > system
        let python_path = find_python(app_dir)?;

        info!("Starting server with: {:?}", python_path);

        let mut cmd = Command::new(&python_path);
        cmd.args(["-m", "uvicorn", "server.main:app", "--host", "127.0.0.1", "--port", "8000"])
            .current_dir(app_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut process = cmd.spawn().map_err(|e| format!("Failed to start server: {e}"))?;

        // Spawn a thread to log server output
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

        *child = Some(process);
        Ok(())
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

impl Drop for ServerManager {
    fn drop(&mut self) {
        self.stop();
    }
}

fn find_python(app_dir: &std::path::Path) -> Result<String, String> {
    // 1. Try venv
    let venv_python = if cfg!(windows) {
        app_dir.join(".venv").join("Scripts").join("python.exe")
    } else {
        app_dir.join(".venv").join("bin").join("python")
    };

    if venv_python.exists() {
        return Ok(venv_python.to_string_lossy().to_string());
    }

    // 2. Try system Python
    let python_name = if cfg!(windows) { "python" } else { "python3" };
    if Command::new(python_name).arg("--version").output().is_ok() {
        return Ok(python_name.to_string());
    }

    // 3. Try python3
    if Command::new("python3").arg("--version").output().is_ok() {
        return Ok("python3".to_string());
    }

    Err("Python not found. Install Python 3.10+ and ensure it's in PATH".to_string())
}
