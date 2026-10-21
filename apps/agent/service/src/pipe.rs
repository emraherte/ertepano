//! Hizmet ↔ arayüz yerel borusu (\\.\pipe\ErtePano.Agent). Satır başına bir JSON.
//!   hizmet → arayüz: {t:"state",…} ve {t:"sync",items:[SignedItem]} (her değişiklikte tam liste)
//!   arayüz → hizmet: {t:"out",msg:{t:"ack"|"safety"|"report",…}}
//! Güvenlik: yalnızca bu bilgisayardaki oturumlar (uzak istemci reddi), DACL ile yalnız SYSTEM/Yöneticiler/etkileşimli
//! kullanıcılar; bağlanan sürecin exe'si hizmetle aynı klasördeki ertepano_agent.exe olmalı.
use crate::hub::Hub;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
use tokio::sync::watch;

/// Etkileşimli kullanıcılar (IU) yalnızca okuma + veri yazma: 0x12008b = FILE_GENERIC_READ | FILE_WRITE_DATA.
/// FILE_CREATE_PIPE_INSTANCE (0x4, GENERIC_WRITE içindedir) VERİLMEZ — kullanıcı sahte sunucu örneği açamaz.
const PIPE_SDDL: &str = "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;OW)(A;;0x12008b;;;IU)";
const MAX_LINE: usize = 64 * 1024;

pub async fn serve(hub: Arc<Hub>, allowed_exe: PathBuf, mut shutdown: watch::Receiver<bool>) {
    let sd = match crate::winsys::SecurityDescriptor::from_sddl(PIPE_SDDL) {
        Ok(sd) => sd,
        Err(e) => {
            ertepano_core::log::log(&format!("boru güvenlik tanımı oluşturulamadı: {e}"));
            return;
        }
    };
    let mut first = true;
    loop {
        let created = unsafe {
            ServerOptions::new()
                .first_pipe_instance(first)
                .reject_remote_clients(true)
                .create_with_security_attributes_raw(ertepano_core::PIPE_NAME, sd.attributes_ptr())
        };
        let server = match created {
            Ok(s) => s,
            Err(e) => {
                // ilk örnek başarısızsa başka bir süreç boruyu ele geçirmiş olabilir
                ertepano_core::log::log(&format!("boru açılamadı: {e}"));
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                continue;
            }
        };
        first = false;
        tokio::select! {
            r = server.connect() => {
                if let Err(e) = r {
                    ertepano_core::log::log(&format!("boru bağlantısı: {e}"));
                    continue;
                }
                let hub = hub.clone();
                let allowed = allowed_exe.clone();
                tokio::spawn(async move { handle(server, hub, allowed).await });
            }
            _ = shutdown.changed() => return,
        }
    }
}

async fn handle(server: NamedPipeServer, hub: Arc<Hub>, allowed_exe: PathBuf) {
    let client = crate::winsys::pipe_client_exe(&server);
    let ok = client.as_ref().is_some_and(|p| p.to_string_lossy().eq_ignore_ascii_case(&allowed_exe.to_string_lossy()));
    if !ok {
        ertepano_core::log::log(&format!("boru: izin verilmeyen istemci reddedildi ({:?})", client));
        return;
    }
    let mut changes = hub.subscribe();
    let (rd, mut wr) = tokio::io::split(server);
    let mut lines = BufReader::new(rd).lines();
    let send = |v: Value| format!("{v}\n");
    if wr.write_all(send(hub.state_json()).as_bytes()).await.is_err() || wr.write_all(send(hub.sync_json()).as_bytes()).await.is_err() {
        return;
    }
    loop {
        tokio::select! {
            line = lines.next_line() => {
                let Ok(Some(line)) = line else { return };
                if line.len() > MAX_LINE {
                    continue;
                }
                let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
                if v.get("t").and_then(|t| t.as_str()) == Some("out") {
                    if let Some(msg) = v.get("msg") {
                        if !hub.forward(msg) {
                            ertepano_core::log::log("boru: bilinmeyen mesaj türü yok sayıldı");
                        }
                    }
                }
            }
            changed = changes.changed() => {
                if changed.is_err() {
                    return;
                }
                let out = format!("{}{}", send(hub.state_json()), send(hub.sync_json()));
                if wr.write_all(out.as_bytes()).await.is_err() {
                    return;
                }
            }
        }
    }
}
