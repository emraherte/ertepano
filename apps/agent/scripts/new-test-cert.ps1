<#
.SYNOPSIS
  ErtePano için TEST kod imzalama sertifikası üretir (kendinden imzalı, 1 yıl).

.DESCRIPTION
  Git for Windows ile gelen openssl kullanılır; Windows sertifika deposuna hiçbir şey eklenmez.
  Çıktılar apps/agent/certs/ altına yazılır (git'e girmez):
    test-codesign.pfx   build-msi.ps1 -PfxPath ile imzalamak için (parolalı)
    test-codesign.cer   test ortamında GPO ile "Trusted Publishers" + "Trusted Root" deposuna dağıtmak için

  ÜRETİM İÇİN KULLANMAYIN: kurumsal PKI'dan (AD CS "Code Signing" şablonu) ya da ticari bir CA'dan
  kod imzalama sertifikası alıp build-msi.ps1 -CertThumbprint ile imzalayın.

.EXAMPLE
  .\new-test-cert.ps1 -Password 'Gizli-Test-Parola'
#>
param(
  [Parameter(Mandatory = $true)][string]$Password,
  [string]$Subject = 'ErtePano Test Kod Imzalama',
  [int]$Days = 365
)
$ErrorActionPreference = 'Stop'

$openssl = Get-Command openssl -ErrorAction SilentlyContinue
$opensslPath = if ($openssl) { $openssl.Source } else { Join-Path $env:ProgramFiles 'Git\mingw64\bin\openssl.exe' }
if (-not (Test-Path $opensslPath)) { throw "openssl bulunamadı (Git for Windows kurulu mu?): $opensslPath" }

$out = Join-Path (Split-Path $PSScriptRoot -Parent) 'certs'
New-Item -ItemType Directory -Force $out | Out-Null
$cnf = Join-Path $out 'codesign.cnf'
$key = Join-Path $out 'test-codesign.key.pem'
$crt = Join-Path $out 'test-codesign.crt.pem'
$pfx = Join-Path $out 'test-codesign.pfx'
$cer = Join-Path $out 'test-codesign.cer'

@"
[req]
distinguished_name = dn
prompt = no
[dn]
CN = $Subject
O = Erte
[v3_cs]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = codeSigning
subjectKeyIdentifier = hash
"@ | Set-Content -Encoding ascii $cnf

# openssl ilerlemeyi stderr'e yazar; PowerShell 5.1 bunu hata saymasın
$ErrorActionPreference = 'Continue'
& $opensslPath req -x509 -newkey rsa:3072 -sha256 -days $Days -nodes -keyout $key -out $crt -config $cnf -extensions v3_cs 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'openssl req başarısız' }
# signtool'un okuyabildiği klasik PFX şifrelemesi
& $opensslPath pkcs12 -export -inkey $key -in $crt -out $pfx -passout "pass:$Password" -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1 -name $Subject 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'openssl pkcs12 başarısız' }
& $opensslPath x509 -in $crt -outform DER -out $cer
if ($LASTEXITCODE -ne 0) { throw 'openssl x509 başarısız' }
$ErrorActionPreference = 'Stop'
Remove-Item $key, $cnf -Force

$thumb = (New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $cer).Thumbprint
Write-Host "Test sertifikası hazır:" -ForegroundColor Green
Write-Host "  PFX : $pfx"
Write-Host "  CER : $cer   (test istemcilerine GPO ile güvenilir yayımcı olarak dağıtın)"
Write-Host "  SHA1: $thumb"
