<#
.SYNOPSIS
  ErtePano Ajan MSI paketini üretir ve (sertifika verilirse) imzalar.

.DESCRIPTION
  1. ertepano-service.exe (release) derlenir
  2. Arayüz Tauri ile derlenir (npx @tauri-apps/cli@2 build). Tauri ilk seferde WiX 3.14 araçlarını
     %LOCALAPPDATA%\tauri\WixTools314 altına indirir; MSI'ı biz kendi tanımımızla (installer/ErtePano.wxs) üretiriz.
  3. İki exe imzalanır → candle/light ile MSI → MSI imzalanır
  4. Çıktı: apps/agent/dist/ErtePano-Ajan-<sürüm>-x64.msi (+ .sha256)

.EXAMPLE
  # Kurumsal sertifika (yerel makine/kullanıcı deposunda, parmak izi ile)
  .\build-msi.ps1 -CertThumbprint 0123ABCD...

.EXAMPLE
  # Test sertifikası (new-test-cert.ps1 ile)
  .\build-msi.ps1 -PfxPath ..\certs\test-codesign.pfx -PfxPassword 'Gizli-Test-Parola'

.EXAMPLE
  # İnternet yoksa zaman damgasız
  .\build-msi.ps1 -PfxPath ..\certs\test-codesign.pfx -PfxPassword '...' -NoTimestamp
#>
param(
  [string]$CertThumbprint,
  [string]$PfxPath,
  [string]$PfxPassword,
  [string]$TimestampUrl = 'http://timestamp.digicert.com',
  [switch]$NoTimestamp,
  [switch]$SkipBuild
)
# cargo/npx/signtool ilerlemeyi stderr'e yazar; PowerShell 5.1 bunu hata saymasın — her adım çıkış koduyla denetlenir
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent               # apps/agent
$version = (Select-String -Path (Join-Path $root 'Cargo.toml') -Pattern '^version\s*=\s*"([^"]+)"').Matches[0].Groups[1].Value
Write-Host "ErtePano Ajan $version" -ForegroundColor Cyan

function Find-Tool($name, [string[]]$dirs) {
  foreach ($d in $dirs) { if ($d -and (Test-Path (Join-Path $d $name))) { return (Join-Path $d $name) } }
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

# ---- 1-2. derleme ----
if (-not $SkipBuild) {
  Push-Location $root
  try {
    cargo build --release -p ertepano-service
    if ($LASTEXITCODE -ne 0) { throw 'hizmet derlenemedi' }
    Push-Location (Join-Path $root 'src-tauri')
    npx --yes @tauri-apps/cli@2 build --bundles msi
    if ($LASTEXITCODE -ne 0) { throw 'arayüz derlenemedi (tauri build)' }
    Pop-Location
  } finally { Pop-Location }
}
$ui = Join-Path $root 'target\release\ertepano_agent.exe'
$svc = Join-Path $root 'target\release\ertepano-service.exe'
foreach ($f in $ui, $svc) { if (-not (Test-Path $f)) { throw "bulunamadı: $f" } }

# ---- araçlar ----
$wixDirs = @($(if ($env:WIX) { Join-Path $env:WIX 'bin' }), (Join-Path $env:LOCALAPPDATA 'tauri\WixTools314'), (Join-Path ${env:ProgramFiles(x86)} 'WiX Toolset v3.14\bin'))
$candle = Find-Tool 'candle.exe' $wixDirs
$light = Find-Tool 'light.exe' $wixDirs
if (-not $candle -or -not $light) { throw 'WiX 3.14 bulunamadı (önce -SkipBuild olmadan çalıştırın; Tauri indirir)' }
$kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
$sdk = Get-ChildItem $kits -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^10\.' } | Sort-Object { [version]$_.Name } -Descending |
  Where-Object { Test-Path (Join-Path $_.FullName 'x64\signtool.exe') } | Select-Object -First 1
$signtool = if ($sdk) { Join-Path $sdk.FullName 'x64\signtool.exe' } else { Find-Tool 'signtool.exe' @() }

$signing = [bool]($CertThumbprint -or $PfxPath)
if ($signing -and -not $signtool) { throw 'signtool.exe bulunamadı (Windows SDK)' }
if (-not $signing) { Write-Warning 'Sertifika verilmedi: paket İMZASIZ üretilecek (yalnızca deneme için).' }

function Invoke-Sign([string]$file) {
  if (-not $signing) { return }
  $base = @('sign', '/fd', 'SHA256', '/d', 'ErtePano Ajan')
  if ($CertThumbprint) { $base += @('/sha1', $CertThumbprint) } else { $base += @('/f', (Resolve-Path $PfxPath).Path, '/p', $PfxPassword) }
  if (-not $NoTimestamp) {
    & $signtool @($base + @('/tr', $TimestampUrl, '/td', 'SHA256', $file))
    if ($LASTEXITCODE -eq 0) { return }
    Write-Warning "Zaman damgası alınamadı ($TimestampUrl) — damgasız imzalanıyor. Sertifika süresi dolunca imza geçersiz sayılır."
  }
  & $signtool @($base + @($file))
  if ($LASTEXITCODE -ne 0) { throw "imzalanamadı: $file" }
}

# ---- 3. imzala → MSI ----
Write-Host 'exe imzalanıyor…' -ForegroundColor Cyan
Invoke-Sign $ui
Invoke-Sign $svc

$obj = Join-Path $root 'target\wix'
New-Item -ItemType Directory -Force $obj | Out-Null
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$msi = Join-Path $dist "ErtePano-Ajan-$version-x64.msi"
$wxs = Join-Path $root 'installer\ErtePano.wxs'
$icon = Join-Path $root 'src-tauri\icons\icon.ico'

& $candle -nologo -arch x64 -ext WixUtilExtension "-dVersion=$version" "-dUiExe=$ui" "-dServiceExe=$svc" "-dIconFile=$icon" -out "$obj\" $wxs
if ($LASTEXITCODE -ne 0) { throw 'candle başarısız' }
& $light -nologo -ext WixUtilExtension -spdb -out $msi (Join-Path $obj 'ErtePano.wixobj')
if ($LASTEXITCODE -ne 0) {
  # ICE doğrulaması Windows Installer hizmetine erişemezse (ör. kısıtlı oturum) doğrulamasız dene
  Write-Warning 'light doğrulaması başarısız — ICE doğrulaması atlanarak yeniden deneniyor (-sval)'
  & $light -nologo -ext WixUtilExtension -spdb -sval -out $msi (Join-Path $obj 'ErtePano.wixobj')
  if ($LASTEXITCODE -ne 0) { throw 'light başarısız' }
}

Write-Host 'MSI imzalanıyor…' -ForegroundColor Cyan
Invoke-Sign $msi

$hash = (Get-FileHash $msi -Algorithm SHA256).Hash
"$hash  $(Split-Path $msi -Leaf)" | Set-Content -Encoding ascii "$msi.sha256"
Write-Host "Hazır: $msi" -ForegroundColor Green
Write-Host "SHA256: $hash"
if ($signing) {
  $sig = Get-AuthenticodeSignature $msi
  Write-Host "İmza: $($sig.Status) — $($sig.SignerCertificate.Subject)"
}
