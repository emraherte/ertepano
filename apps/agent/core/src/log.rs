//! Basit dosya günlüğü (1 MB'ı aşınca baştan başlar). Yol, süreç başında `init` ile verilir.
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;

static PATH: OnceLock<PathBuf> = OnceLock::new();

pub fn init(path: PathBuf) {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = PATH.set(path);
}

pub fn log(msg: &str) {
    let line = format!("{} {msg}\n", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"));
    #[cfg(debug_assertions)]
    eprint!("{line}");
    let Some(path) = PATH.get() else { return };
    let truncate = std::fs::metadata(path).map(|m| m.len() > 1_000_000).unwrap_or(false);
    let file = std::fs::OpenOptions::new().create(true).write(true).append(!truncate).truncate(truncate).open(path);
    if let Ok(mut f) = file {
        let _ = f.write_all(line.as_bytes());
    }
}
