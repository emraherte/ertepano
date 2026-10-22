//! Ed25519 imza doğrulama + tazelik kuralları (docs/PROTOKOL.md §4).
use crate::model::{parse_time, Announcement, SignedItem};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};

/// Acil (tam ekran) yükler en fazla bu kadar eski olabilir — eski alarmın tekrar oynatılmasını engeller.
const FULLSCREEN_MAX_AGE_HOURS: i64 = 24;

pub fn verify(public_key_b64: &str, s: &SignedItem) -> Result<Announcement, String> {
    let kb = STANDARD.decode(public_key_b64.trim()).map_err(|e| format!("genel anahtar çözülemedi: {e}"))?;
    let kb: [u8; 32] = kb.try_into().map_err(|_| "genel anahtar 32 bayt değil".to_string())?;
    let vk = VerifyingKey::from_bytes(&kb).map_err(|e| format!("genel anahtar geçersiz: {e}"))?;
    let sb = STANDARD.decode(s.sig.trim()).map_err(|e| format!("imza çözülemedi: {e}"))?;
    let sig = Signature::from_slice(&sb).map_err(|e| format!("imza biçimi: {e}"))?;
    vk.verify(s.payload.as_bytes(), &sig).map_err(|_| "imza geçersiz".to_string())?;

    let a: Announcement = serde_json::from_str(&s.payload).map_err(|e| format!("yük okunamadı: {e}"))?;
    if a.id.is_empty() {
        return Err("yükte id yok".into());
    }
    let now = chrono::Utc::now();
    if parse_time(&a.expires_at).is_some_and(|t| t <= now) {
        return Err(format!("{}: süresi dolmuş", a.id));
    }
    if a.kind == "fullscreen"
        && parse_time(&a.issued_at).is_some_and(|t| now.signed_duration_since(t) > chrono::Duration::hours(FULLSCREEN_MAX_AGE_HOURS))
    {
        return Err(format!("{}: acil yük çok eski", a.id));
    }
    Ok(a)
}
