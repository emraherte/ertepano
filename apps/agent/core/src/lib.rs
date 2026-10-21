//! ErtePano ajan çekirdeği — Windows hizmeti (ertepano-service) ve kullanıcı arayüzü (ertepano_agent) ortak kullanır.
//! Sözleşme: docs/PROTOKOL.md
pub mod client;
pub mod config;
pub mod log;
pub mod model;
pub mod sys;
pub mod telemetry;
pub mod verify;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Hizmet ↔ arayüz yerel boru adı (yalnızca bu bilgisayar).
pub const PIPE_NAME: &str = r"\\.\pipe\ErtePano.Agent";
/// Windows hizmet adı
pub const SERVICE_NAME: &str = "ErtePanoAgent";
/// Hizmetin başlattığı arayüz programı (hizmet exe'si ile aynı klasörde)
pub const UI_EXE: &str = "ertepano_agent.exe";

pub fn lock<T>(m: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}
