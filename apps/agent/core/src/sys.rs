//! Küçük Windows yardımcıları: HKLM kayıt defteri okuma ve konsoldaki (oturum açmış) kullanıcı.
//! Hizmet SYSTEM olarak çalıştığı için %USERNAME% işe yaramaz; kullanıcı adı aktif konsol oturumundan okunur.

#[cfg(windows)]
mod imp {
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
    use windows::Win32::System::RemoteDesktop::{
        WTSFreeMemory, WTSGetActiveConsoleSessionId, WTSQuerySessionInformationW, WTSUserName, WTS_CURRENT_SERVER_HANDLE,
    };

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// HKLM\<key> altındaki REG_SZ değer (yoksa None).
    pub fn reg_string(key: &str, name: &str) -> Option<String> {
        let (k, n) = (wide(key), wide(name));
        let mut size: u32 = 0;
        unsafe {
            if RegGetValueW(HKEY_LOCAL_MACHINE, PCWSTR(k.as_ptr()), PCWSTR(n.as_ptr()), RRF_RT_REG_SZ, None, None, Some(&mut size)).is_err() {
                return None;
            }
            let mut buf = vec![0u16; (size as usize).div_ceil(2) + 1];
            let mut size2 = (buf.len() * 2) as u32;
            if RegGetValueW(
                HKEY_LOCAL_MACHINE,
                PCWSTR(k.as_ptr()),
                PCWSTR(n.as_ptr()),
                RRF_RT_REG_SZ,
                None,
                Some(buf.as_mut_ptr().cast()),
                Some(&mut size2),
            )
            .is_err()
            {
                return None;
            }
            let len = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
            let s = String::from_utf16_lossy(&buf[..len]).trim().to_string();
            (!s.is_empty()).then_some(s)
        }
    }

    /// Bir oturumdaki kullanıcı adı ("ahmet.yilmaz"); oturum yoksa None.
    pub fn session_user(session_id: u32) -> Option<String> {
        unsafe {
            let mut buf = PWSTR::null();
            let mut bytes: u32 = 0;
            WTSQuerySessionInformationW(Some(WTS_CURRENT_SERVER_HANDLE), session_id, WTSUserName, &mut buf, &mut bytes).ok()?;
            let s = buf.to_string().unwrap_or_default();
            WTSFreeMemory(buf.0.cast());
            (!s.is_empty()).then_some(s)
        }
    }

    pub fn console_user() -> Option<String> {
        let id = unsafe { WTSGetActiveConsoleSessionId() };
        if id == u32::MAX {
            return None;
        }
        session_user(id)
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn reg_string(_key: &str, _name: &str) -> Option<String> {
        None
    }
    pub fn session_user(_id: u32) -> Option<String> {
        None
    }
    pub fn console_user() -> Option<String> {
        None
    }
}

pub use imp::*;

/// Telemetri ve kayıt için kullanıcı: önce konsoldaki oturum, yoksa süreç ortamı (SYSTEM değilse).
pub fn current_user() -> String {
    if let Some(u) = console_user() {
        return u;
    }
    std::env::var("USERNAME")
        .ok()
        .filter(|u| !u.ends_with('$') && !u.eq_ignore_ascii_case("SYSTEM"))
        .unwrap_or_default()
}
