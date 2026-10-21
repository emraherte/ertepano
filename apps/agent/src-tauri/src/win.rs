//! Thin Win32 helpers (monitors / work areas, cursor, overlay window styles, fullscreen-app detection).
//! Taken from the ErtePals stage engine. HWNDs are passed around as `isize` so they are Send and independent
//! of tauri's `windows` crate version.
#![allow(clippy::missing_safety_doc)]

#[derive(Clone, Debug, PartialEq)]
pub struct PhysRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}
impl PhysRect {
    pub fn contains(&self, px: i32, py: i32) -> bool {
        px >= self.x && py >= self.y && px < self.x + self.w && py < self.y + self.h
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct MonitorRaw {
    pub id: String,
    pub primary: bool,
    pub monitor: PhysRect,
    pub work: PhysRect,
    pub scale: f64,
}

#[cfg(windows)]
mod imp {
    use super::*;
    use std::ffi::c_void;
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT};
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, MonitorFromWindow, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW,
        MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::System::Threading::GetCurrentProcessId;
    use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
    use windows::Win32::UI::Shell::SHQueryUserNotificationState;
    use windows::Win32::UI::WindowsAndMessaging::*;

    fn hwnd(h: isize) -> HWND {
        HWND(h as *mut c_void)
    }

    unsafe extern "system" fn enum_proc(hmon: HMONITOR, _hdc: HDC, _rc: *mut RECT, data: LPARAM) -> BOOL {
        let out = &mut *(data.0 as *mut Vec<MonitorRaw>);
        let mut info: MONITORINFOEXW = std::mem::zeroed();
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
        if GetMonitorInfoW(hmon, &mut info as *mut MONITORINFOEXW as *mut MONITORINFO).as_bool() {
            let dev = String::from_utf16_lossy(&info.szDevice);
            let dev = dev.trim_end_matches('\0').to_string();
            let (mut dx, mut dy) = (96u32, 96u32);
            let _ = GetDpiForMonitor(hmon, MDT_EFFECTIVE_DPI, &mut dx, &mut dy);
            let r = info.monitorInfo.rcMonitor;
            let w = info.monitorInfo.rcWork;
            out.push(MonitorRaw {
                id: dev,
                primary: info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
                monitor: PhysRect { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top },
                work: PhysRect { x: w.left, y: w.top, w: w.right - w.left, h: w.bottom - w.top },
                scale: (dx.max(48) as f64) / 96.0,
            });
        }
        BOOL(1)
    }

    pub fn monitors() -> Vec<MonitorRaw> {
        let mut out: Vec<MonitorRaw> = Vec::new();
        unsafe {
            let _ = EnumDisplayMonitors(None, None, Some(enum_proc), LPARAM(&mut out as *mut _ as isize));
        }
        out.sort_by(|a, b| b.primary.cmp(&a.primary).then(a.id.cmp(&b.id)));
        out
    }

    pub fn cursor_pos() -> Option<(i32, i32)> {
        let mut p = POINT::default();
        unsafe { GetCursorPos(&mut p).ok().map(|_| (p.x, p.y)) }
    }

    /// Overlay styles: tool window (no Alt-Tab), no-activate (never steals focus), click-through on/off.
    pub fn ensure_overlay_style(h: isize, click_through: bool) -> bool {
        let cur = unsafe { GetWindowLongPtrW(hwnd(h), GWL_EXSTYLE) };
        if cur == 0 {
            return false;
        }
        let tool = WS_EX_TOOLWINDOW.0 as isize;
        let noact = WS_EX_NOACTIVATE.0 as isize;
        let appw = WS_EX_APPWINDOW.0 as isize;
        let through = (WS_EX_TRANSPARENT.0 | WS_EX_LAYERED.0) as isize;
        let mut want = (cur | tool | noact) & !appw;
        if click_through {
            want |= through;
        } else {
            want &= !through;
        }
        if want != cur {
            unsafe {
                SetWindowLongPtrW(hwnd(h), GWL_EXSTYLE, want);
            }
            true
        } else {
            false
        }
    }

    pub fn assert_topmost(h: isize) {
        unsafe {
            let _ = SetWindowPos(
                hwnd(h),
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOSENDCHANGING,
            );
        }
    }

    pub fn set_rect(h: isize, r: &PhysRect) {
        unsafe {
            let _ = SetWindowPos(hwnd(h), None, r.x, r.y, r.w, r.h, SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
        }
    }

    fn class_name(h: HWND) -> String {
        let mut buf = [0u16; 128];
        let n = unsafe { GetClassNameW(h, &mut buf) };
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }

    fn foreground_covers_monitor() -> bool {
        unsafe {
            let fg = GetForegroundWindow();
            if fg.0.is_null() {
                return false;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(fg, Some(&mut pid));
            if pid == GetCurrentProcessId() {
                return false;
            }
            let cls = class_name(fg);
            if matches!(cls.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd") {
                return false;
            }
            let mut r = RECT::default();
            if GetWindowRect(fg, &mut r).is_err() {
                return false;
            }
            let mon = MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST);
            let mut info: MONITORINFO = std::mem::zeroed();
            info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
            if !GetMonitorInfoW(mon, &mut info).as_bool() {
                return false;
            }
            let m = info.rcMonitor;
            r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom
        }
    }

    /// A fullscreen game / presentation / video is in front ("do not disturb").
    pub fn fullscreen_app() -> bool {
        match unsafe { SHQueryUserNotificationState() } {
            // QUNS_BUSY = 2, QUNS_RUNNING_D3D_FULL_SCREEN = 3, QUNS_PRESENTATION_MODE = 4
            Ok(s) => match s.0 {
                3 | 4 => true,
                2 => foreground_covers_monitor(),
                _ => false,
            },
            Err(_) => false,
        }
    }
}

#[cfg(windows)]
pub use imp::*;

#[cfg(not(windows))]
mod imp {
    use super::*;
    pub fn monitors() -> Vec<MonitorRaw> {
        vec![MonitorRaw {
            id: "primary".into(),
            primary: true,
            monitor: PhysRect { x: 0, y: 0, w: 1920, h: 1080 },
            work: PhysRect { x: 0, y: 0, w: 1920, h: 1040 },
            scale: 1.0,
        }]
    }
    pub fn cursor_pos() -> Option<(i32, i32)> {
        None
    }
    pub fn ensure_overlay_style(_h: isize, _c: bool) -> bool {
        false
    }
    pub fn assert_topmost(_h: isize) {}
    pub fn set_rect(_h: isize, _r: &PhysRect) {}
    pub fn fullscreen_app() -> bool {
        false
    }
}
#[cfg(not(windows))]
pub use imp::*;
