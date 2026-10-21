//! Hizmet borusuna güvenli bağlanma.
//! - Boru yalnızca FILE_GENERIC_READ | FILE_WRITE_DATA ile açılır (hizmetin DACL'i etkileşimli kullanıcılara bu kadarını verir).
//! - Bağlanınca öbür uçtaki sunucu doğrulanır: oturum 0'da çalışan, exe'si bu arayüzle aynı klasördeki
//!   ertepano-service.exe olan ve (jetonu okunabiliyorsa) SYSTEM olan süreç. Böylece bir kullanıcının açtığı sahte
//!   boru sunucusu diğer oturumların arayüzüne boş liste gönderip acil uyarıyı bastıramaz, bildirimleri toplayamaz.
//! - Geliştirme: hizmet `--console` ile kullanıcı oturumunda çalışırken ERTEPANO_DEV_PIPE=1 doğrulamayı atlatır;
//!   hizmetin başlattığı (`--managed`) arayüzde bu ASLA dikkate alınmaz.
use std::ffi::c_void;
use std::os::windows::io::{AsRawHandle, RawHandle};
use std::path::PathBuf;
use tokio::net::windows::named_pipe::NamedPipeClient;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Security::{GetTokenInformation, IsWellKnownSid, TokenUser, WinLocalSystemSid, TOKEN_QUERY, TOKEN_USER};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, FILE_FLAG_OVERLAPPED, FILE_GENERIC_READ, FILE_SHARE_NONE, FILE_WRITE_DATA, OPEN_EXISTING, SECURITY_IDENTIFICATION,
    SECURITY_SQOS_PRESENT,
};
use windows::Win32::System::Pipes::GetNamedPipeServerProcessId;
use windows::Win32::System::RemoteDesktop::ProcessIdToSessionId;
use windows::Win32::System::Threading::{OpenProcess, OpenProcessToken, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};

const SERVICE_EXE: &str = "ertepano-service.exe";

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn io_err(e: windows::core::Error) -> std::io::Error {
    std::io::Error::from_raw_os_error((e.code().0 as u32 & 0xFFFF) as i32)
}

/// Boruyu en az yetkiyle aç (GENERIC_WRITE istenmez: içinde FILE_CREATE_PIPE_INSTANCE vardır ve DACL vermez).
pub fn open(name: &str) -> std::io::Result<NamedPipeClient> {
    let n = wide(name);
    let h = unsafe {
        CreateFileW(
            PCWSTR(n.as_ptr()),
            FILE_GENERIC_READ.0 | FILE_WRITE_DATA.0,
            FILE_SHARE_NONE,
            None,
            OPEN_EXISTING,
            FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION,
            None,
        )
    }
    .map_err(io_err)?;
    // SAFETY: CreateFileW'den gelen, sahibi olduğumuz örtüşmeli (overlapped) boru tanıtıcısı
    unsafe { NamedPipeClient::from_raw_handle(h.0 as RawHandle) }
}

fn process_exe(pid: u32) -> Option<PathBuf> {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = vec![0u16; 1024];
        let mut len = buf.len() as u32;
        let r = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(h);
        r.ok()?;
        Some(PathBuf::from(String::from_utf16_lossy(&buf[..len as usize])))
    }
}

/// Jetonu okunabiliyorsa SYSTEM mi? None = jeton okunamadı (başka hesabın süreci; kendi sürecimiz olsaydı okunurdu).
fn token_is_system(pid: u32) -> Option<bool> {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut tok = HANDLE::default();
        let opened = OpenProcessToken(h, TOKEN_QUERY, &mut tok);
        let _ = CloseHandle(h);
        opened.ok()?;
        let mut buf = vec![0u8; 256];
        let mut len = 0u32;
        let r = GetTokenInformation(tok, TokenUser, Some(buf.as_mut_ptr() as *mut c_void), buf.len() as u32, &mut len);
        let _ = CloseHandle(tok);
        if r.is_err() {
            return Some(false);
        }
        let user = &*(buf.as_ptr() as *const TOKEN_USER);
        Some(IsWellKnownSid(user.User.Sid, WinLocalSystemSid).as_bool())
    }
}

/// Öbür uçtaki sunucu gerçekten ErtePano hizmeti mi?
pub fn verify_server(pipe: &NamedPipeClient, managed: bool) -> Result<(), String> {
    if !managed && std::env::var("ERTEPANO_DEV_PIPE").as_deref() == Ok("1") {
        ertepano_core::log::log("UYARI: ERTEPANO_DEV_PIPE=1 — boru sunucusu doğrulaması atlandı (yalnız geliştirme)");
        return Ok(());
    }
    let mut pid = 0u32;
    unsafe { GetNamedPipeServerProcessId(HANDLE(pipe.as_raw_handle()), &mut pid) }.map_err(|e| format!("sunucu süreci alınamadı: {e}"))?;
    let mut session = u32::MAX;
    unsafe { ProcessIdToSessionId(pid, &mut session) }.map_err(|e| format!("sunucu oturumu alınamadı: {e}"))?;
    if session != 0 {
        return Err(format!("boru sunucusu hizmet oturumunda değil (oturum {session}, pid {pid})"));
    }
    let expected = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join(SERVICE_EXE))).ok_or("exe yolu alınamadı")?;
    let actual = process_exe(pid).ok_or("sunucu exe yolu alınamadı")?;
    if !actual.to_string_lossy().eq_ignore_ascii_case(&expected.to_string_lossy()) {
        return Err(format!("boru sunucusu beklenen hizmet değil: {}", actual.display()));
    }
    if token_is_system(pid) == Some(false) {
        return Err(format!("boru sunucusu SYSTEM hesabıyla çalışmıyor (pid {pid})"));
    }
    Ok(())
}
