<#
.SYNOPSIS
  Simulate-GpoInstall.ps1 ile yapılan test kurulumunu geri alır. YÖNETİCİ gerekir.

.DESCRIPTION
  MSI'ı sessiz kaldırır (hizmet durur, arayüzler kapanır, dosyalar silinir) ve test ilke değerlerini siler.
  -KeepIdentity verilmezse %ProgramData%\ErtePano\service (cihaz kimliği) de silinir; bir sonraki kurulum
  yeni kayıt yapar (sunucuda aynı bilgisayar adı + MAC ile aynı cihaz kaydına eşlenir).
#>
#Requires -RunAsAdministrator
param([switch]$KeepIdentity, [switch]$KeepPolicy)
$ErrorActionPreference = 'Stop'

$prod = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -eq 'ErtePano Ajan' } | Select-Object -First 1
if ($prod) {
  $log = Join-Path $env:TEMP 'ErtePano-msi-uninstall.log'
  $p = Start-Process msiexec.exe -ArgumentList @('/x', $prod.PSChildName, '/qn', '/norestart', '/l*v', "`"$log`"") -Wait -PassThru
  Write-Host "Kaldırma çıkış kodu: $($p.ExitCode) (günlük: $log)"
} else {
  Write-Host 'ErtePano Ajan kurulu değil.'
}
if (-not $KeepPolicy) { Remove-Item 'HKLM:\SOFTWARE\Policies\ErtePano' -Recurse -Force -ErrorAction SilentlyContinue; Write-Host 'Test ilke değerleri silindi.' }
if (-not $KeepIdentity) { Remove-Item (Join-Path $env:ProgramData 'ErtePano\service') -Recurse -Force -ErrorAction SilentlyContinue; Write-Host 'Hizmet verisi (cihaz kimliği) silindi.' }
