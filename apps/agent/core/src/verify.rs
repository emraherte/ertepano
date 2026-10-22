//! Ed25519 imza doğrulama + tazelik kuralları (docs/PROTOKOL.md §4, §7).
use crate::model::{parse_time, Announcement, SignedItem, SupportRequest};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};

/// Acil (tam ekran) yükler en fazla bu kadar eski olabilir — eski alarmın tekrar oynatılmasını engeller.
const FULLSCREEN_MAX_AGE_HOURS: i64 = 24;

fn check_sig(public_key_b64: &str, s: &SignedItem) -> Result<(), String> {
    let kb = STANDARD.decode(public_key_b64.trim()).map_err(|e| format!("genel anahtar çözülemedi: {e}"))?;
    let kb: [u8; 32] = kb.try_into().map_err(|_| "genel anahtar 32 bayt değil".to_string())?;
    let vk = VerifyingKey::from_bytes(&kb).map_err(|e| format!("genel anahtar geçersiz: {e}"))?;
    let sb = STANDARD.decode(s.sig.trim()).map_err(|e| format!("imza çözülemedi: {e}"))?;
    let sig = Signature::from_slice(&sb).map_err(|e| format!("imza biçimi: {e}"))?;
    vk.verify(s.payload.as_bytes(), &sig).map_err(|_| "imza geçersiz".to_string())
}

pub fn verify(public_key_b64: &str, s: &SignedItem) -> Result<Announcement, String> {
    check_sig(public_key_b64, s)?;
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

/// Uzaktan destek isteği: imza + tür + süre (onay penceresi en fazla `expiresAt`'e kadar açık kalabilir).
/// Bir duyuru imzası destek isteği yerine (ya da tersi) kullanılamaz: `type` alanı zorunludur.
pub fn verify_support(public_key_b64: &str, s: &SignedItem) -> Result<SupportRequest, String> {
    check_sig(public_key_b64, s)?;
    let r: SupportRequest = serde_json::from_str(&s.payload).map_err(|e| format!("destek isteği okunamadı: {e}"))?;
    if r.kind != "support_request" {
        return Err("yük bir destek isteği değil".into());
    }
    if r.session_id.is_empty() || r.session_id.len() > 64 {
        return Err("destek isteğinde oturum kimliği yok".into());
    }
    if r.relay_token.len() != 64 || !r.relay_token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("destek isteğinde jeton geçersiz".into());
    }
    if !matches!(r.mode.as_str(), "view" | "control") {
        return Err("destek isteğinde mod geçersiz".into());
    }
    let now = chrono::Utc::now();
    match parse_time(&r.expires_at) {
        Some(t) if t > now => {}
        _ => return Err(format!("{}: destek isteğinin süresi dolmuş", r.session_id)),
    }
    Ok(r)
}
