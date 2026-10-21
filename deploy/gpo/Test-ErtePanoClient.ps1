<#
.SYNOPSIS
  Bir istemcide ErtePano kurulumunu denetler (GPO sonrası "kuruldu mu, çalışıyor mu?").

.DESCRIPTION
  Yönetici gerekmez (hizmet günlüğünü okumak için gerekir; yoksa o adım atlanır).
  Kontroller: MSI kurulu mu · hizmet çalışıyor/otomatik mi · kurtarma ayarı · yapılandırma kaynağı (GPO/MSI/dosya)
  · exe imzaları · oturumdaki arayüz süreci · hizmet günlüğünün son satırları · sunucuya erişim.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Test-ErtePanoClient.ps1
#>
$ErrorActionPreference = 'Continue'
$fail = 0
function Ok($m) { Write-Host "  [TAMAM] $m" -ForegroundColor Green }
function Bad($m) { Write-Host "  [HATA ] $m" -ForegroundColor Red; $script:fail++ }
function Warn($m) { Write-Host "  [UYARI] $m" -ForegroundColor Yellow }

Write-Host "`nErtePano istemci denetimi — $env:COMPUTERNAME" -ForegroundColor Cyan

# 1. MSI
$prod = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -eq 'ErtePano Ajan' } | Select-Object -First 1
if ($prod) { Ok "Kurulu: ErtePano Ajan $($prod.DisplayVersion) ($($prod.PSChildName))" } else { Bad 'MSI kurulu değil (GPO uygulanmadı mı? gpresult /r ve Application olay günlüğü → Application Management)' }

# 2. Hizmet
$svc = Get-CimInstance Win32_Service -Filter "Name='ErtePanoAgent'" -ErrorAction SilentlyContinue
if (-not $svc) { Bad 'Hizmet (ErtePanoAgent) yok' }
else {
  if ($svc.State -eq 'Running') { Ok "Hizmet çalışıyor (pid $($svc.ProcessId), hesap $($svc.StartName))" } else { Bad "Hizmet durumu: $($svc.State)" }
  if ($svc.StartMode -eq 'Auto') { Ok 'Başlangıç türü: Otomatik' } else { Warn "Başlangıç türü: $($svc.StartMode)" }
  $fa = (sc.exe qfailure ErtePanoAgent) -join ' '
  if ($fa -match 'RESTART') { Ok 'Kurtarma: çökerse yeniden başlat' } else { Warn 'Kurtarma eylemi ayarlı değil' }
  $exe = $svc.PathName.Trim('"')
  $dir = Split-Path $exe -Parent
  foreach ($f in @($exe, (Join-Path $dir 'ertepano_agent.exe'))) {
    if (-not (Test-Path $f)) { Bad "Dosya yok: $f"; continue }
    $sig = Get-AuthenticodeSignature $f
    $who = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { '-' }
    switch ($sig.Status) {
      'Valid' { Ok "İmza geçerli: $(Split-Path $f -Leaf) — $who" }
      'NotSigned' { Warn "İmzasız: $(Split-Path $f -Leaf)" }
      default { Warn "İmza durumu $($sig.Status): $(Split-Path $f -Leaf) — $who (test sertifikası güvenilir yayımcılara eklenmemiş olabilir)" }
    }
  }
}

# 3. Yapılandırma
$pol = Get-ItemProperty 'HKLM:\SOFTWARE\Policies\ErtePano' -ErrorAction SilentlyContinue
$msi = Get-ItemProperty 'HKLM:\SOFTWARE\ErtePano' -ErrorAction SilentlyContinue
$file = Join-Path $env:ProgramData 'ErtePano\agent.json'
$server = $null
if (Test-Path $file) {
  # ajan, sahibi SYSTEM/Yöneticiler olmayan agent.json'ı güvenlik gereği yok sayar
  $owner = (Get-Acl $file).Owner
  $sid = try { (New-Object System.Security.Principal.NTAccount $owner).Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { '' }
  if ($sid -in @('S-1-5-18', 'S-1-5-32-544')) {
    try { $j = Get-Content $file -Raw | ConvertFrom-Json; $server = $j.serverUrl; Ok "agent.json: $file (sahip $owner)" } catch { Bad "agent.json okunamadı: $_" }
  } else {
    Bad "agent.json sahibi güvenilir değil ($owner) — ajan bu dosyayı yok sayar. Düzeltme: icacls `"$file`" /setowner *S-1-5-32-544"
  }
}
if (-not $server -and $msi -and $msi.ServerUrl) { $server = $msi.ServerUrl; Ok 'Yapılandırma: MSI özellikleri (HKLM\SOFTWARE\ErtePano)' }
if ($pol) {
  if ($pol.ServerUrl) { $server = $pol.ServerUrl }
  Ok ("GPO ilkesi: " + ((@('ServerUrl', 'EnrollKey', 'PublicKey', 'Location', 'Department') | Where-Object { $pol.$_ }) -join ', '))
}
if (-not ($pol -and $pol.PublicKey) -and -not ($j -and $j.publicKey) -and -not ($msi -and $msi.PublicKey)) { Bad 'Genel anahtar (PublicKey) yapılandırılmamış — arayüz hiçbir duyuru göstermez' }
if ($server) { Ok "Sunucu: $server" } else { Bad 'Sunucu adresi hiçbir kaynakta yok (GPO ErtePano.admx → Sunucu adresi)' }

# 4. Sunucuya erişim
if ($server) {
  try {
    $h = Invoke-RestMethod -Uri "$($server.TrimEnd('/'))/api/health" -TimeoutSec 8 -UseBasicParsing
    if ($h.ok) { Ok 'Sunucu erişilebilir (/api/health)' } else { Bad 'Sunucu yanıtı beklenmedik' }
  } catch { Bad "Sunucuya erişilemiyor: $($_.Exception.Message)" }
}

# 5. Arayüz süreçleri (oturum başına)
$ui = Get-CimInstance Win32_Process -Filter "Name='ertepano_agent.exe'" -ErrorAction SilentlyContinue
if ($ui) { $ui | ForEach-Object { Ok "Arayüz çalışıyor: oturum $($_.SessionId), pid $($_.ProcessId)" } }
else { Warn 'Arayüz süreci yok (oturum açık değilse normal; hizmet 10 sn içinde başlatır)' }

# 6. Hizmet günlüğü
$log = Join-Path $env:ProgramData 'ErtePano\service\service.log'
try {
  $lines = Get-Content $log -Tail 10 -Encoding UTF8 -ErrorAction Stop
  Write-Host "`n  service.log (son 10 satır):" -ForegroundColor Cyan
  $lines | ForEach-Object { Write-Host "    $_" }
  if (($lines -join "`n") -match 'durum: Bağlı') { Ok 'Hizmet sunucuya bağlı' }
} catch { Warn 'service.log okunamadı (yönetici olarak çalıştırın)' }

Write-Host ''
if ($fail -eq 0) { Write-Host 'Sonuç: sorun bulunmadı.' -ForegroundColor Green; exit 0 } else { Write-Host "Sonuç: $fail hata." -ForegroundColor Red; exit 1 }
