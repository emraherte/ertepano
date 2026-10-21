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
    psd: PSECURITY_DESCRIPTOR,
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

/// Hizmet veri klasörü: yalnızca SYSTEM ve Yöneticiler (cihaz sırrı burada). SID'ler dil bağımsız.
pub fn secure_dir(dir: &Path) {
    let out = std::process::Command::new("icacls")
        .arg(dir)
        .args(["/inheritance:r", "/grant:r", "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F", "/Q"])
        .output();
    match out {
        Ok(o) if o.status.success() => {}
        Ok(o) => ertepano_core::log::log(&format!("veri klasörü izinleri ayarlanamadı: {}", String::from_utf8_lossy(&o.stderr).trim())),
        Err(e) => ertepano_core::log::log(&format!("icacls çalıştırılamadı: {e}")),
    }
}
