<#
.SYNOPSIS
  ErtePano sunucusunu bir Windows Server'a kurar (yönetici PowerShell, internet gerekmez).

.DESCRIPTION
  - Dosyaları -InstallDir'e kopyalar (bu betik sürüm klasörünün içinden çalıştırılır: server, apps/panel/dist, packages, node_modules)
  - Kurumsal sertifika (.pfx) verilirse HTTPS'i doğrudan sunar — IIS/reverse proxy gerekmez
  - Sunucuyu ayrıcalıksız "NT AUTHORITY\NETWORK SERVICE" hesabıyla, açılışta başlayan ve çökerse yeniden başlayan
    bir zamanlanmış görev olarak kaydeder
  - Veri klasörünü yalnızca SYSTEM, Yöneticiler ve NETWORK SERVICE'e açar
  - Güvenlik duvarında yalnızca Etki Alanı profilinde bağlantı noktasını açar
  Kurulumdan sonra tarayıcıda {PublicUrl}/kurulum açılır.

.EXAMPLE
  .\Install-ErtePanoServer.ps1 -PublicUrl https://pano.sirket.local -PfxPath C:\certs\pano.pfx
  .\Install-ErtePanoServer.ps1 -Uninstall
#>
[CmdletBinding()]
param(
  [string]$PublicUrl,
  [string]$PfxPath,
  [string]$InstallDir = 'C:\ErtePano',
  [string]$DataDir,
  [int]$Port,
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$TaskName = 'ErtePano Sunucu'
$RuleName = 'ErtePano Sunucu (HTTPS)'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Bu betik yönetici olarak çalıştırılmalı.'
}

if ($Uninstall) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
  Write-Host "Görev ve güvenlik duvarı kuralı kaldırıldı. Veri ($InstallDir\data) ve yedekler YERİNDE bırakıldı." -ForegroundColor Yellow
  return
}

if (-not $PublicUrl -or $PublicUrl -notmatch '^https?://') { throw '-PublicUrl gerekli (örn. https://pano.sirket.local)' }
if (-not $DataDir) { $DataDir = Join-Path $InstallDir 'data' }
if (-not $Port) { $Port = if ($PfxPath) { 443 } else { 4100 } }

# 1) Node.js 20+
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js bulunamadı. https://nodejs.org adresinden Node 20 LTS MSI paketini (çevrimdışı) kurun ve betiği yeniden çalıştırın.' }
$ver = (& $node -v).TrimStart('v').Split('.')
if ([int]$ver[0] -lt 20) { throw "Node $($ver -join '.') eski; en az 20.10 gerekli." }

# 2) Dosyalar
$src = Resolve-Path (Join-Path $PSScriptRoot '..\..')
foreach ($need in 'server\src\index.ts', 'apps\panel\dist\index.html', 'node_modules') {
  if (-not (Test-Path (Join-Path $src $need))) { throw "Sürüm klasöründe eksik: $need (önce 'npm ci' ve 'npm run build')" }
}
Write-Host "Kopyalanıyor: $src → $InstallDir"
robocopy $src $InstallDir /MIR /XD data .git target certs dist-agent /XF .env *.lic /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy hata kodu $LASTEXITCODE" }

# 3) Sertifika
$envLines = @(
  "PUBLIC_URL=$PublicUrl",
  "PORT=$Port",
  "DATA_DIR=$DataDir",
  'DATA_DIR_ACL=managed'
)
if ($PfxPath) {
  $pfxPass = Read-Host -AsSecureString 'PFX parolası'
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pfxPass))
  $certDir = Join-Path $InstallDir 'certs'
  New-Item -ItemType Directory -Force $certDir | Out-Null
  Copy-Item $PfxPath (Join-Path $certDir 'server.pfx') -Force
  $envLines += "TLS_PFX_PATH=$(Join-Path $certDir 'server.pfx')"
  $envLines += "TLS_PFX_PASSWORD=$plain"
  icacls $certDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-20:(OI)(CI)R' | Out-Null
} elseif ($PublicUrl -like 'https://*') {
  Write-Warning 'PublicUrl https ama -PfxPath verilmedi: HTTPS önünüzdeki reverse proxy tarafından sağlanmalı. TRUST_PROXY ve SECURE_COOKIES=true .env dosyasına eklenmeli.'
  $envLines += 'SECURE_COOKIES=true'
}

# 4) .env (yalnızca SYSTEM, Yöneticiler, NETWORK SERVICE okuyabilir)
$envFile = Join-Path $InstallDir '.env'
Set-Content -Path $envFile -Value $envLines -Encoding UTF8
icacls $envFile /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' '*S-1-5-20:R' | Out-Null

# 5) Veri klasörü
New-Item -ItemType Directory -Force $DataDir | Out-Null
icacls $DataDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-20:(OI)(CI)M' | Out-Null
icacls "$DataDir\*" /reset /T /C /Q 2>$null | Out-Null

# 6) Zamanlanmış görev (açılışta, NETWORK SERVICE, çökerse 1 dk sonra yeniden)
$action = New-ScheduledTaskAction -Execute $node -Argument '--import tsx src\index.ts' -WorkingDirectory (Join-Path $InstallDir 'server')
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\NETWORKSERVICE' -LogonType ServiceAccount -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'ErtePano kurumsal ekran iletişimi sunucusu' | Out-Null

# 7) Güvenlik duvarı (yalnızca etki alanı ağı)
Remove-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Domain | Out-Null

# 8) Başlat ve sağlığı kontrol et
Start-ScheduledTask -TaskName $TaskName
$scheme = if ($PfxPath) { 'https' } else { 'http' }
[System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }  # yalnızca bu yerel sağlık kontrolü için
$ok = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 1
  try { if ((Invoke-WebRequest -UseBasicParsing "${scheme}://localhost:$Port/api/health" -TimeoutSec 3).StatusCode -eq 200) { $ok = $true; break } } catch {}
}
[System.Net.ServicePointManager]::ServerCertificateValidationCallback = $null
if (-not $ok) { throw "Sunucu yanıt vermedi. Görev Zamanlayıcı → '$TaskName' geçmişine ve $DataDir klasörüne bakın." }

Write-Host ''
Write-Host '=== ErtePano sunucusu çalışıyor ===' -ForegroundColor Green
Write-Host "Panel          : $PublicUrl/kurulum"
Write-Host "İlk parola     : $DataDir\ILK-YONETICI-PAROLASI.txt  (kullanıcı adı: admin — ilk girişte değiştirin; dosya kendiliğinden silinir)"
Write-Host "Yedekler       : $DataDir\backups (günlük, son 14 gün) — bu klasörü sunucu dışına da kopyalayın"
Write-Host "Kaldırma       : .\Install-ErtePanoServer.ps1 -Uninstall  (veri silinmez)"
