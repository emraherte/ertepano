//! Basit dosya günlüğü: %APPDATA%\ErtePano\agent.log (1 MB'ı aşınca baştan başlar).
use std::io::Write;

pub fn log(msg: &str) {
    let line = format!("{} {msg}\n", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"));
    #[cfg(debug_assertions)]
    eprint!("{line}");
    let path = crate::config::data_dir().join("agent.log");
    let truncate = std::fs::metadata(&path).map(|m| m.len() > 1_000_000).unwrap_or(false);
    let file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(!truncate)
        .truncate(truncate)
        .open(path);
    if let Ok(mut f) = file {
        let _ = f.write_all(line.as_bytes());
    }
}
