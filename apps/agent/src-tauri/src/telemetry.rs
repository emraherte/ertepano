//! Cihaz durumu (docs/PROTOKOL.md §3 Telemetry). Yalnızca envanter alanları — ekran, pencere, klavye, dosya YOK.
use crate::agent::{lock, Agent, VERSION};
use serde_json::{json, Value};
use sysinfo::{Disks, System};

pub fn user() -> String {
    std::env::var("USERNAME").or_else(|_| std::env::var("USER")).unwrap_or_default()
}

pub fn hostname() -> String {
    System::host_name().unwrap_or_else(|| std::env::var("COMPUTERNAME").unwrap_or_default())
}

pub fn mac() -> String {
    mac_address::get_mac_address().ok().flatten().map(|m| m.to_string()).unwrap_or_default()
}

pub fn ip() -> String {
    local_ip_address::local_ip().map(|i| i.to_string()).unwrap_or_default()
}

pub fn os() -> String {
    let long = System::long_os_version().unwrap_or_else(|| "Bilinmeyen".into());
    match System::kernel_version() {
        Some(k) if !long.contains(&k) => format!("{long} {k}"),
        _ => long,
    }
}

/// Kayıt için kimlik: (hostname, mac, os, user)
pub fn identity() -> (String, String, String, String) {
    (hostname(), mac(), os(), user())
}

pub fn collect(ag: &Agent) -> Value {
    let mut sys = lock(&ag.sys);
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    let cpu_model = sys.cpus().first().map(|c| c.brand().trim().to_string()).unwrap_or_default();
    let cpu_load = sys.global_cpu_usage();
    let ram_total = sys.total_memory() / (1024 * 1024);
    let ram_free = sys.available_memory() / (1024 * 1024);
    drop(sys);

    let disks = Disks::new_with_refreshed_list();
    let sys_drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
    let disk = disks
        .list()
        .iter()
        .find(|d| d.mount_point().to_string_lossy().to_uppercase().starts_with(&sys_drive.to_uppercase()))
        .or_else(|| disks.list().first());
    let gb = |b: u64| (b as f64 / 1024f64.powi(3) * 10.0).round() / 10.0;
    let (disk_total, disk_free) = disk.map(|d| (gb(d.total_space()), gb(d.available_space()))).unwrap_or((0.0, 0.0));

    json!({
        "hostname": hostname(),
        "ip": ip(),
        "mac": mac(),
        "user": user(),
        "os": os(),
        "cpuModel": cpu_model,
        "cpuLoad": (cpu_load as f64 * 10.0).round() / 10.0,
        "ramTotalMb": ram_total,
        "ramFreeMb": ram_free,
        "diskTotalGb": disk_total,
        "diskFreeGb": disk_free,
        "uptimeSec": System::uptime(),
        "agentVersion": VERSION,
    })
}
