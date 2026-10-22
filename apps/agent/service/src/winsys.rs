//! Hizmetin Win32 işleri: boru güvenlik tanımı, bağlanan sürecin exe'si, oturumlar ve oturumda arayüz başlatma.
use std::ffi::c_void;
use std::os::windows::io::AsRawHandle;
use std::path::{Path, PathBuf};
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, LocalFree, HANDLE, HLOCAL};
use windows::Win32::Security::Authorization::{ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1};
use windows::Win32::Security::{
    DuplicateTokenEx, SecurityIdentification, TokenPrimary, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_ACCESS_MASK,
};
use windows::Win32::System::Environment::{CreateEnvironmentBlock, DestroyEnvironmentBlock};
use windows::Win32::System::Pipes::GetNamedPipeClientProcessId;
use windows::Win32::System::RemoteDesktop::{
    ProcessIdToSessionId, WTSActive, WTSEnumerateSessionsW, WTSFreeMemory, WTSQueryUserToken, WTS_CURRENT_SERVER_HANDLE,
    WTS_SESSION_INFOW,
};
use windows::Win32::System::Threading::{
    CreateProcessAsUserW, OpenProcess, QueryFullProcessImageNameW, CREATE_UNICODE_ENVIRONMENT, PROCESS_INFORMATION,
    PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, STARTUPINFOW,
};

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// SDDL'den güvenlik tanımı; boru oluşturulurken SECURITY_ATTRIBUTES olarak verilir.
pub struct SecurityDescriptor {
    pub psd: PSECURITY_DESCRIPTOR,
    attrs: SECURITY_ATTRIBUTES,
}

unsafe impl Send for SecurityDescriptor {}
unsafe impl Sync for SecurityDescriptor {}

impl SecurityDescriptor {
    pub fn from_sddl(sddl: &str) -> windows::core::Result<Box<SecurityDescriptor>> {
        let w = wide(sddl);
        let mut psd = PSECURITY_DESCRIPTOR::default();
        unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(PCWSTR(w.as_ptr()), SDDL_REVISION_1, &mut psd, None)? };
        let mut sd = Box::new(SecurityDescriptor {
            psd,
            attrs: SECURITY_ATTRIBUTES { nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: psd.0, bInheritHandle: false.into() },
        });
        sd.attrs.lpSecurityDescriptor = sd.psd.0;
        Ok(sd)
    }

    pub fn attributes_ptr(&self) -> *mut c_void {
        &self.attrs as *const SECURITY_ATTRIBUTES as *mut c_void
    }
}

impl Drop for SecurityDescriptor {
    fn drop(&mut self) {
        unsafe {
            let _ = LocalFree(Some(HLOCAL(self.psd.0)));
        }
    }
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

/// Borunun öbür ucundaki sürecin exe yolu.
pub fn pipe_client_exe(pipe: &impl AsRawHandle) -> Option<PathBuf> {
    let mut pid = 0u32;
    unsafe { GetNamedPipeClientProcessId(HANDLE(pipe.as_raw_handle()), &mut pid).ok()? };
    process_exe(pid)
}

/// Borunun öbür ucundaki sürecin Windows oturumu.
pub fn pipe_client_session(pipe: &impl AsRawHandle) -> Option<u32> {
    let mut pid = 0u32;
    unsafe { GetNamedPipeClientProcessId(HANDLE(pipe.as_raw_handle()), &mut pid).ok()? };
    session_of(pid)
}

/// Fiziksel konsoldaki (ekran başındaki) oturum; kimse yoksa None.
pub fn console_session() -> Option<u32> {
    let s = unsafe { windows::Win32::System::RemoteDesktop::WTSGetActiveConsoleSessionId() };
    (s != u32::MAX && s != 0).then_some(s)
}

pub fn session_of(pid: u32) -> Option<u32> {
    let mut sid = 0u32;
    unsafe { ProcessIdToSessionId(pid, &mut sid).ok()? };
    Some(sid)
}

/// Kullanıcının oturum açmış olduğu (etkin) oturumlar.
pub fn active_sessions() -> Vec<u32> {
    let mut out = vec![];
    unsafe {
        let mut info: *mut WTS_SESSION_INFOW = std::ptr::null_mut();
        let mut count = 0u32;
        if WTSEnumerateSessionsW(Some(WTS_CURRENT_SERVER_HANDLE), 0, 1, &mut info, &mut count).is_err() {
            return out;
        }
        for s in std::slice::from_raw_parts(info, count as usize) {
            // 0 = hizmet oturumu (masaüstü yok)
            if s.State == WTSActive && s.SessionId != 0 {
                out.push(s.SessionId);
            }
        }
        WTSFreeMemory(info.cast());
    }
    out
}

/// Arayüzü kullanıcının oturumunda, kullanıcının kimliğiyle başlatır (hizmet SYSTEM olarak çalışırken).
pub fn launch_in_session(session: u32, exe: &Path) -> windows::core::Result<u32> {
    unsafe {
        let mut user = HANDLE::default();
        WTSQueryUserToken(session, &mut user)?;
        let mut primary = HANDLE::default();
        let dup = DuplicateTokenEx(user, TOKEN_ACCESS_MASK(0x0200_0000 /* MAXIMUM_ALLOWED */), None, SecurityIdentification, TokenPrimary, &mut primary);
        let _ = CloseHandle(user);
        dup?;

        let mut env: *mut c_void = std::ptr::null_mut();
        if let Err(e) = CreateEnvironmentBlock(&mut env, Some(primary), false) {
            let _ = CloseHandle(primary);
            return Err(e);
        }
        let mut desktop = wide(r"winsta0\default");
        let si = STARTUPINFOW { cb: std::mem::size_of::<STARTUPINFOW>() as u32, lpDesktop: PWSTR(desktop.as_mut_ptr()), ..Default::default() };
        let mut pi = PROCESS_INFORMATION::default();
        let mut cmd = wide(&format!("\"{}\" --managed", exe.display()));
        let dir = wide(&exe.parent().map(|p| p.display().to_string()).unwrap_or_default());
        let r = CreateProcessAsUserW(
            Some(primary),
            PCWSTR::null(),
            Some(PWSTR(cmd.as_mut_ptr())),
            None,
            None,
            false,
            CREATE_UNICODE_ENVIRONMENT,
            Some(env as *const c_void),
            PCWSTR(dir.as_ptr()),
            &si,
            &mut pi,
        );
        let _ = DestroyEnvironmentBlock(env);
        let _ = CloseHandle(primary);
        r?;
        let _ = CloseHandle(pi.hThread);
        let _ = CloseHandle(pi.hProcess);
        Ok(pi.dwProcessId)
    }
}

/// %ProgramData%\ErtePano: sahibi SYSTEM; SYSTEM + Yöneticiler tam, Kullanıcılar yalnız okuma (arayüz agent.json'ı okur).
const ROOT_SDDL: &str = "O:SYG:SYD:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;BU)";
/// %ProgramData%\ErtePano\service: sahibi SYSTEM; yalnız SYSTEM + Yöneticiler (cihaz sırrı burada).
const SERVICE_SDDL: &str = "O:SYG:SYD:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)";

fn enable_privilege(name: &str) {
    use windows::Win32::Foundation::LUID;
    use windows::Win32::Security::{
        AdjustTokenPrivileges, LookupPrivilegeValueW, LUID_AND_ATTRIBUTES, SE_PRIVILEGE_ENABLED, TOKEN_ADJUST_PRIVILEGES, TOKEN_PRIVILEGES,
        TOKEN_QUERY,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    unsafe {
        let mut tok = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, &mut tok).is_err() {
            return;
        }
        let w = wide(name);
        let mut luid = LUID::default();
        if LookupPrivilegeValueW(PCWSTR::null(), PCWSTR(w.as_ptr()), &mut luid).is_ok() {
            let tp = TOKEN_PRIVILEGES { PrivilegeCount: 1, Privileges: [LUID_AND_ATTRIBUTES { Luid: luid, Attributes: SE_PRIVILEGE_ENABLED }] };
            let _ = AdjustTokenPrivileges(tok, false, Some(&tp), 0, None, None);
        }
        let _ = CloseHandle(tok);
    }
}

/// Yalnızca bu nesnenin (klasörün) sahibini ve DACL'ini yazar — alt öğelere YAYILMAZ (SetFileSecurityW).
/// Böylece kullanıcının önceden yerleştirdiği sabit bağlantılar üzerinden başka dosyaların izinleri değiştirilemez.
fn set_object_sd(path: &Path, sddl: &str) -> Result<(), String> {
    use windows::Win32::Security::{DACL_SECURITY_INFORMATION, GROUP_SECURITY_INFORMATION, OWNER_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION};
    use windows::Win32::Security::SetFileSecurityW;
    let sd = SecurityDescriptor::from_sddl(sddl).map_err(|e| e.to_string())?;
    let p = wide(&path.to_string_lossy());
    let info = OWNER_SECURITY_INFORMATION | GROUP_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION;
    unsafe { SetFileSecurityW(PCWSTR(p.as_ptr()), info, sd.psd) }.ok().map_err(|e| e.to_string())
}

fn is_reparse_point(path: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;
    std::fs::symlink_metadata(path).map(|m| m.file_attributes() & 0x400 != 0).unwrap_or(false)
}

/// Hizmet modunda veri klasörlerini sertleştirir:
/// - kullanıcının yarattığı bağlantı (junction/symlink) kaldırılır, gerçek klasör yaratılır;
/// - ErtePano\ ve ErtePano\service\ sahibi SYSTEM yapılır, DACL sıfırlanır (açık ACE'ler gider);
/// - sahibi SYSTEM/Yöneticiler olmayan (önceden kullanıcı yaratmış) service\ klasörü kullanılmaz, kenara alınır.
pub fn harden_data_dirs(root: &Path, service: &Path) {
    let log = ertepano_core::log::log;
    enable_privilege("SeTakeOwnershipPrivilege");
    enable_privilege("SeRestorePrivilege");
    for dir in [root, service] {
        if is_reparse_point(dir) {
            log(&format!("GÜVENLİK: {} bir bağlantı (reparse point) — kaldırılıyor", dir.display()));
            let _ = std::fs::remove_dir(dir);
        }
    }
    let _ = std::fs::create_dir_all(root);
    if let Err(e) = set_object_sd(root, ROOT_SDDL) {
        log(&format!("{} izinleri ayarlanamadı: {e}", root.display()));
    }
    if service.exists() && !ertepano_core::sys::trusted_owner(service) {
        // klasörü önce kendimize al (yalnız klasör nesnesi), sonra kenara taşı; içindekilere dokunma
        let _ = set_object_sd(service, SERVICE_SDDL);
        let aside = service.with_file_name(format!("service.reddedildi-{}", chrono::Local::now().format("%Y%m%d%H%M%S")));
        match std::fs::rename(service, &aside) {
            Ok(()) => log(&format!("GÜVENLİK: sahibi güvenilmeyen {} kenara alındı → {}", service.display(), aside.display())),
            Err(e) => log(&format!("GÜVENLİK: güvenilmeyen {} taşınamadı: {e}", service.display())),
        }
    }
    let _ = std::fs::create_dir_all(service);
    if let Err(e) = set_object_sd(service, SERVICE_SDDL) {
        log(&format!("{} izinleri ayarlanamadı: {e}", service.display()));
    }
}
