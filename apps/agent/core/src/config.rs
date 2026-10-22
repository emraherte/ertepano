//! Kurulum yapılandırması ve kayıt sonrası cihaz kimliği (docs/PROTOKOL.md §1).
//!
//! Kaynaklar (sırayla; ilk bulunan temel alınır):
//!   1. %ProgramData%\ErtePano\agent.json            (GPP → Files ile dağıtım)
//!   2. HKLM\SOFTWARE\ErtePano                        (msiexec SERVERURL=… ENROLLKEY=… PUBLICKEY=…)
//!   3. exe'nin yanındaki agent.json
//!   4. ERTEPANO_CONFIG ortam değişkeni               (geliştirme)
//! Ardından HKLM\SOFTWARE\Policies\ErtePano (GPO yönetim şablonu, ErtePano.admx) dolu alanları ezer.
//!
//! Güvenlik: dosya kaynakları (1, 3) yalnızca dosyanın sahibi SYSTEM ya da Yöneticiler ise kabul edilir — standart
//! kullanıcı kendi sunucu adresi + imza anahtarıyla agent.json bırakıp sahte acil durum gösteremesin.
//! ERTEPANO_CONFIG (4) yalnızca geliştirmede (hizmetin --console modu, hizmetsiz arayüz) okunur.
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const MSI_KEY: &str = r"SOFTWARE\ErtePano";
pub const POLICY_KEY: &str = r"SOFTWARE\Policies\ErtePano";

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub server_url: String,
    pub enroll_key: String,
    /// Sunucunun Ed25519 genel anahtarı (base64, 32 bayt). Boşsa ilk kayıtta güvenilir (TOFU).
    pub public_key: String,
    /// Kayıtta önerilen lokasyon/departman (GPO ile OU başına verilebilir)
    pub location: String,
    pub department: String,
    /// mTLS istemci sertifikası (veri klasöründeki client.pfx) parolası; sertifika parolasızsa boş
    pub client_cert_password: String,
    /// Nereden okunduğu (günlük ve "durum" ekranı için)
    #[serde(skip)]
    pub source: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct DeviceFile {
    pub device_id: String,
    pub device_secret: String,
    /// TOFU ile sabitlenen genel anahtar (yapılandırmada anahtar yoksa)
    pub public_key: String,
    /// Kaydın yapıldığı sunucu; yapılandırma başka sunucuya işaret ederse yeniden kayıt olunur
    pub server_url: String,
}

/// %ProgramData%\ErtePano
pub fn program_data() -> PathBuf {
    std::env::var_os("ProgramData").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\ProgramData")).join("ErtePano")
}

/// %APPDATA%\ErtePano (kullanıcıya özel: okundu kayıtları, arayüz günlüğü)
pub fn user_data() -> PathBuf {
    let base = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let dir = base.join("ErtePano");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn from_file(path: &Path, require_trusted_owner: bool) -> Option<Config> {
    if !path.is_file() {
        return None;
    }
    if require_trusted_owner && !crate::sys::trusted_owner(path) {
        crate::log::log(&format!(
            "UYARI: {} yok sayıldı — dosya sahibi SYSTEM ya da Yöneticiler değil (düzeltmek için: icacls \"{}\" /setowner *S-1-5-32-544)",
            path.display(),
            path.display()
        ));
        return None;
    }
    let text = std::fs::read_to_string(path).ok()?;
    match serde_json::from_str::<Config>(text.trim_start_matches('\u{feff}')) {
        Ok(mut c) => {
            c.source = path.display().to_string();
            Some(c)
        }
        Err(e) => {
            crate::log::log(&format!("{} okunamadı: {e}", path.display()));
            None
        }
    }
}

fn from_registry(key: &str) -> Config {
    let r = |n: &str| crate::sys::reg_string(key, n).unwrap_or_default();
    Config {
        server_url: r("ServerUrl"),
        enroll_key: r("EnrollKey"),
        public_key: r("PublicKey"),
        location: r("Location"),
        department: r("Department"),
        client_cert_password: r("ClientCertPassword"),
        source: format!(r"HKLM\{key}"),
    }
}

/// `allow_dev_env`: ERTEPANO_CONFIG okunsun mu (yalnız geliştirme: hizmetin --console modu, hizmetsiz arayüz).
pub fn load(allow_dev_env: bool) -> Option<Config> {
    let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf));
    let msi = from_registry(MSI_KEY);
    let mut cfg = from_file(&program_data().join("agent.json"), true)
        .or_else(|| (!msi.server_url.is_empty()).then_some(msi))
        .or_else(|| exe_dir.and_then(|d| from_file(&d.join("agent.json"), true)))
        .or_else(|| {
            if !allow_dev_env {
                return None;
            }
            std::env::var_os("ERTEPANO_CONFIG").and_then(|p| from_file(Path::new(&p), false))
        })
        .unwrap_or_default();

    let policy = from_registry(POLICY_KEY);
    let mut overridden = false;
    for (dst, src) in [
        (&mut cfg.server_url, policy.server_url),
        (&mut cfg.enroll_key, policy.enroll_key),
        (&mut cfg.public_key, policy.public_key),
        (&mut cfg.location, policy.location),
        (&mut cfg.department, policy.department),
        (&mut cfg.client_cert_password, policy.client_cert_password),
    ] {
        if !src.is_empty() {
            *dst = src;
            overridden = true;
        }
    }
    if overridden {
        cfg.source = if cfg.source.is_empty() { policy.source } else { format!("{} + GPO", cfg.source) };
    }

    cfg.server_url = cfg.server_url.trim().trim_end_matches('/').to_string();
    if cfg.server_url.is_empty() {
        crate::log::log("yapılandırma bulunamadı (agent.json / kayıt defteri / GPO)");
        return None;
    }
    crate::log::log(&format!("yapılandırma: {}", cfg.source));
    Some(cfg)
}

pub fn load_device(dir: &Path) -> Option<DeviceFile> {
    let text = std::fs::read_to_string(dir.join("device.json")).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn save_device(dir: &Path, d: &DeviceFile) {
    if let Ok(text) = serde_json::to_string_pretty(d) {
        let _ = std::fs::write(dir.join("device.json"), text);
    }
}

/// Kimliği unut ama TOFU anahtarını koru (yeniden kayıtta sahte sunucu anahtarı kabul edilmesin).
pub fn clear_device(dir: &Path, keep_key: &str) {
    if keep_key.is_empty() {
        let _ = std::fs::remove_file(dir.join("device.json"));
    } else {
        save_device(dir, &DeviceFile { public_key: keep_key.to_string(), ..Default::default() });
    }
}
