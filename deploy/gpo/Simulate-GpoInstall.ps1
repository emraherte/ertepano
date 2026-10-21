<#
.SYNOPSIS
  Tek bir bilgisayarda GPO dağıtımını taklit eder (etki alanı olmadan test için). YÖNETİCİ gerekir.

.DESCRIPTION
  GPO'nun yapacağı iki şeyi aynı sırayla yapar:
    1. Yönetim şablonu (ErtePano.admx) ayarları → HKLM\SOFTWARE\Policies\ErtePano
    2. Software Installation (Assigned) → msiexec /i … /qn (makine geneli, sessiz), ayrıntılı günlükle
  Ardından Test-ErtePanoClient.ps1 çalıştırılır.

.EXAMPLE
  .\Simulate-GpoInstall.ps1 -Msi ..\..\apps\agent\dist\ErtePano-Ajan-0.2.0-x64.msi `
      -ServerUrl http://10.0.0.5:4100 -EnrollKey EK-XXXX-XXXX-XXXX -PublicKey 'base64…' -Location 'Gebze Fabrika'
#>
#Requires -RunAsAdministrator
param(
  [Parameter(Mandatory = $true)][string]$Msi,
  [Parameter(Mandatory = $true)][string]$ServerUrl,
  [Parameter(Mandatory = $true)][string]$EnrollKey,
  [string]$PublicKey,
  [string]$Location,
  [string]$Department
)
$ErrorActionPreference = 'Stop'
$msiPath = (Resolve-Path $Msi).Path

$sig = Get-AuthenticodeSignature $msiPath
Write-Host "MSI imzası: $($sig.Status) $(if ($sig.SignerCertificate) { '— ' + $sig.SignerCertificate.Subject })"

Write-Host '1/2 İlke değerleri (GPO yönetim şablonu gibi) yazılıyor…' -ForegroundColor Cyan
$key = 'HKLM:\SOFTWARE\Policies\ErtePano'
New-Item -Path $key -Force | Out-Null
$values = @{ ServerUrl = $ServerUrl; EnrollKey = $EnrollKey; PublicKey = $PublicKey; Location = $Location; Department = $Department }
foreach ($k in $values.Keys) {
  if ($values[$k]) { New-ItemProperty -Path $key -Name $k -Value $values[$k] -PropertyType String -Force | Out-Null }
  else { Remove-ItemProperty -Path $key -Name $k -ErrorAction SilentlyContinue }
}

Write-Host '2/2 MSI sessiz kuruluyor (GPO Software Installation gibi)…' -ForegroundColor Cyan
$log = Join-Path $env:TEMP 'ErtePano-msi-install.log'
$p = Start-Process msiexec.exe -ArgumentList @('/i', "`"$msiPath`"", '/qn', '/norestart', '/l*v', "`"$log`"") -Wait -PassThru
switch ($p.ExitCode) {
  0 { Write-Host 'Kurulum tamam.' -ForegroundColor Green }
  3010 { Write-Host 'Kurulum tamam (yeniden başlatma öneriliyor).' -ForegroundColor Yellow }
  default { Write-Host "msiexec çıkış kodu $($p.ExitCode) — günlük: $log" -ForegroundColor Red; exit $p.ExitCode }
}
Write-Host "Ayrıntılı kurulum günlüğü: $log"

Start-Sleep -Seconds 12   # hizmet kaydolsun, bekçi arayüzü başlatsın
& (Join-Path $PSScriptRoot 'Test-ErtePanoClient.ps1')
